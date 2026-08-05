import type { Job as BullJob } from "bullmq";
import { withJobLifecycle, type BullJobData } from "./helpers";
import { Project } from "@/modules/projects/models/Project";
import { Character } from "@/modules/characters/models/Character";
import { Asset } from "@/modules/assets/models/Asset";
import { resolveGenerationAccount } from "@/modules/accounts/service";
import { recordAccountUsage } from "@/modules/accounts/selector";
import { getImageProvider } from "@/core/ai/registry";
import { uploadImageAsset, toBuffer } from "@/core/storage/cloudinary";
import type { CharacterPose } from "@/core/ai/types";
import { resolveActiveTemplate } from "@/modules/prompt-templates/service";
import { getProviderOverride } from "@/modules/settings/service";
import { onCharacterOrBackgroundReady } from "@/core/queue/orchestrator";
import { checkImageResolution, TARGET_IMAGE_4_5 } from "@/core/quality/checks";
import { QualityCheckFailedError } from "@/core/quality/errors";
import { computeDHash, dHashSimilarity } from "@/core/quality/perceptual-hash";
import type { QualityIssue } from "@/core/quality/types";

/** Below this dHash similarity to the front-view pose, a pose is flagged as a possible
 * consistency miss — advisory only (some divergence between "front-view" and "running-pose" is
 * normal), never a retry trigger. See core/quality/perceptual-hash.ts for what dHash is and isn't. */
const CONSISTENCY_WARNING_THRESHOLD = 0.45;

// The Character Library's "Expressions" set — front view plus the emotions/poses a producer
// needs across scenes, so a new character is reuse-ready without a second generation pass.
const DEFAULT_POSES: CharacterPose[] = ["front-view", "happy", "sad", "angry", "walking-pose", "running-pose"];

/** PDF Step 2 — Create Characters (character turnaround sheet), a subset of poses per generation. */
export async function processCharacterImageJob(bullJob: BullJob<BullJobData>) {
  return withJobLifecycle(bullJob, async (jobDoc) => {
    if (!jobDoc.characterId) throw new Error("Job is missing characterId");
    const [character, project] = await Promise.all([
      Character.findOne({ _id: jobDoc.characterId, userId: jobDoc.userId }),
      Project.findOne({ _id: jobDoc.projectId, userId: jobDoc.userId }),
    ]);
    if (!character) throw new Error("Character not found");
    if (!project) throw new Error("Project not found");

    const { accountId, context } = await resolveGenerationAccount(jobDoc.userId);
    jobDoc.set("googleAccountId", accountId);
    await jobDoc.save();

    const poses = (jobDoc.payload?.poses as CharacterPose[] | undefined) ?? DEFAULT_POSES;
    const providerId = await getProviderOverride(jobDoc.userId, "image");
    const provider = getImageProvider(providerId);
    const style = project.style === "Custom" ? (project.customStyleDescription ?? "Custom") : project.style;
    const templateOverride = await resolveActiveTemplate(jobDoc.userId, "character");

    const images = await provider.generateCharacterSheet(
      {
        spec: {
          name: character.name,
          style,
          age: character.spec?.age ?? undefined,
          bodyType: character.spec?.bodyType ?? undefined,
          face: character.spec?.face ?? undefined,
          eyes: character.spec?.eyes ?? undefined,
          hair: character.spec?.hair ?? undefined,
          clothes: character.spec?.clothes ?? undefined,
          shoes: character.spec?.shoes ?? undefined,
          accessories: character.spec?.accessories ?? undefined,
          personality: character.spec?.personality ?? undefined,
        },
        poses,
        aspectRatio: "4:5",
        templateOverride,
      },
      context,
    );
    await recordAccountUsage(accountId);

    const sheetAssets = [];
    const poseHashes: Partial<Record<CharacterPose, string>> = {};
    for (const pose of poses) {
      const image = images[pose];
      if (!image) continue;
      const uploaded = await uploadImageAsset(image.data, {
        folder: `projects/${jobDoc.projectId}/characters/${character._id.toString()}`,
        publicId: pose,
      });
      const resolutionIssues = checkImageResolution(uploaded, TARGET_IMAGE_4_5);
      if (resolutionIssues.length > 0) {
        throw new QualityCheckFailedError(resolutionIssues.map((i) => ({ ...i, message: `[${pose}] ${i.message}` })));
      }

      poseHashes[pose] = await computeDHash(await toBuffer(image.data)).catch(() => undefined);

      const asset = await Asset.create({
        userId: jobDoc.userId,
        projectId: jobDoc.projectId,
        kind: "image",
        cloudinaryPublicId: uploaded.publicId,
        url: uploaded.url,
        width: uploaded.width,
        height: uploaded.height,
        bytes: uploaded.bytes,
      });
      sheetAssets.push({ pose, assetId: asset._id });
    }

    character.set("sheetAssets", sheetAssets);
    await character.save();

    await onCharacterOrBackgroundReady(jobDoc.userId, jobDoc.projectId.toString());

    // Within-batch consistency: every non-front-view pose compared to front-view, all generated in
    // this same call. Advisory only — see CONSISTENCY_WARNING_THRESHOLD's comment.
    const qualityIssues: QualityIssue[] = [];
    const frontHash = poseHashes["front-view"];
    if (frontHash) {
      for (const [pose, hash] of Object.entries(poseHashes) as [CharacterPose, string][]) {
        if (pose === "front-view" || !hash) continue;
        const similarity = dHashSimilarity(frontHash, hash);
        if (similarity < CONSISTENCY_WARNING_THRESHOLD) {
          qualityIssues.push({
            severity: "warning",
            check: "character-consistency",
            message: `"${pose}" looks quite different from "front-view" (${Math.round(similarity * 100)}% similar) — worth a visual check.`,
          });
        }
      }
    }

    return { poseCount: sheetAssets.length, qualityIssues };
  });
}
