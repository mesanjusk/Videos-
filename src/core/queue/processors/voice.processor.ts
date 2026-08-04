import type { Job as BullJob } from "bullmq";
import { withJobLifecycle, type BullJobData, type ProcessorResult } from "./helpers";
import { Scene } from "@/modules/scenes/models/Scene";
import { Character } from "@/modules/characters/models/Character";
import { Asset } from "@/modules/assets/models/Asset";
import { resolveGenerationAccount } from "@/modules/accounts/service";
import { recordAccountUsage } from "@/modules/accounts/selector";
import { getVoiceProvider } from "@/core/ai/registry";
import { uploadAudioAsset } from "@/core/storage/cloudinary";

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

    const { accountId, context } = await resolveGenerationAccount(jobDoc.userId);
    jobDoc.set("googleAccountId", accountId);
    await jobDoc.save();

    const provider = getVoiceProvider();
    const voice = await provider.generateVoice(
      {
        text: scene.dialogue,
        characterName: primaryCharacter?.name,
        gender: primaryCharacter?.voiceProfile?.gender ?? undefined,
        age: primaryCharacter?.voiceProfile?.age ?? undefined,
        tone: primaryCharacter?.voiceProfile?.tone ?? undefined,
      },
      context,
    );
    await recordAccountUsage(accountId);

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
    scene.status = scene.videoAssetId ? "complete" : "voice_ready";
    await scene.save();

    return { assetId: asset._id.toString() };
  });
}
