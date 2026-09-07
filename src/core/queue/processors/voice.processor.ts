import type { Job as BullJob } from "bullmq";
import { withJobLifecycle, type BullJobData, type ProcessorResult } from "./helpers";
import { Scene } from "@/modules/scenes/models/Scene";
import { Character } from "@/modules/characters/models/Character";
import { Asset } from "@/modules/assets/models/Asset";
import { resolveGenerationAccountOrEnvKey } from "@/modules/accounts/service";
import { recordAccountUsage } from "@/modules/accounts/selector";
import { getVoiceProvider } from "@/core/ai/registry";
import { uploadAudioAsset } from "@/core/storage/cloudinary";
import { resolveActiveTemplate } from "@/modules/prompt-templates/service";
import { getProviderOverride } from "@/modules/settings/service";
import { advanceScene } from "@/core/queue/orchestrator";

/** PDF Step 6 — Voice. */
export async function processVoiceJob(bullJob: BullJob<BullJobData>): Promise<ProcessorResult> {
  return withJobLifecycle(bullJob, async (jobDoc) => {
    if (!jobDoc.sceneId) throw new Error("Job is missing sceneId");
    const scene = await Scene.findOne({ _id: jobDoc.sceneId, userId: jobDoc.userId });
    if (!scene) throw new Error("Scene not found");
    if (!scene.dialogue?.trim()) throw new Error("This scene has no dialogue to voice");

    const primaryCharacter = scene.characterIds?.[0]
      ? await Character.findOne({ _id: scene.characterIds[0], userId: jobDoc.userId }).lean()
      : null;

    // Null when no pooled account is available but GEMINI_API_KEY is — the providers take an
    // optional context and fall back to that key themselves.
    const account = await resolveGenerationAccountOrEnvKey(jobDoc.userId);
    const context = account?.context;
    if (account) jobDoc.set("googleAccountId", account.accountId);
    await jobDoc.save();

    const providerId = await getProviderOverride(jobDoc.userId, "voice");
    const provider = getVoiceProvider(providerId);
    const templateOverride = await resolveActiveTemplate(jobDoc.userId, "voice");
    const voice = await provider.generateVoice(
      {
        text: scene.dialogue,
        characterName: primaryCharacter?.name,
        gender: primaryCharacter?.voiceProfile?.gender ?? undefined,
        age: primaryCharacter?.voiceProfile?.age ?? undefined,
        tone: primaryCharacter?.voiceProfile?.tone ?? undefined,
        templateOverride,
      },
      context,
    );
    if (account) await recordAccountUsage(account.accountId);

    const uploaded = await uploadAudioAsset(voice.data, {
      folder: `projects/${jobDoc.projectId}/scenes/${scene._id.toString()}`,
      publicId: "voice",
    });
    const asset = await Asset.create({
      userId: jobDoc.userId,
      projectId: jobDoc.projectId,
      kind: "audio",
      cloudinaryPublicId: uploaded.publicId,
      url: uploaded.url,
      durationSeconds: voice.durationSeconds ?? uploaded.durationSeconds,
      bytes: uploaded.bytes,
    });

    scene.set("voiceAssetId", asset._id);
    scene.set("voiceStale", false);
    scene.status = scene.videoAssetId ? "complete" : "voice_ready";
    await scene.save();

    await advanceScene(jobDoc.userId, jobDoc.projectId!.toString(), scene._id.toString());

    return { assetId: asset._id.toString() };
  });
}
