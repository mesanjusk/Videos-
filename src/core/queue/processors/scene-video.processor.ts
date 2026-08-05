import type { Job as BullJob } from "bullmq";
import type { HydratedDocument } from "mongoose";
import { withJobLifecycle, type BullJobData, type ProcessorResult } from "./helpers";
import { Project } from "@/modules/projects/models/Project";
import { Scene, type SceneDoc } from "@/modules/scenes/models/Scene";
import { Character } from "@/modules/characters/models/Character";
import { Asset } from "@/modules/assets/models/Asset";
import { getVideoProvider } from "@/core/ai/registry";
import { uploadVideoAsset } from "@/core/storage/cloudinary";
import { resolveActiveTemplate } from "@/modules/prompt-templates/service";
import { getProviderOverride } from "@/modules/settings/service";
import { advanceScene } from "@/core/queue/orchestrator";
import type { VideoGenerationResult } from "@/core/ai/types";

/**
 * Uploads a completed video result to Cloudinary, records it as an Asset, and flips the Scene to
 * `video_ready` — shared by every VideoProvider path that can actually finish synchronously
 * (today: the browser-automation provider in scene-video-auto.processor.ts; a future API-backed
 * provider would land here too). Kept in this file (not the auto processor) so it's reachable from
 * the shared registry without pulling anything automation-specific along with it.
 */
export async function completeSceneVideo(
  scene: HydratedDocument<SceneDoc>,
  userId: string,
  projectId: string,
  result: Extract<VideoGenerationResult, { status: "completed" }>,
) {
  const uploaded = await uploadVideoAsset(result.data, {
    folder: `projects/${projectId}/scenes/${scene._id.toString()}`,
    publicId: "video",
  });
  const asset = await Asset.create({
    userId,
    projectId,
    kind: "video",
    cloudinaryPublicId: uploaded.publicId,
    url: uploaded.url,
    durationSeconds: result.durationSeconds ?? uploaded.durationSeconds,
    bytes: uploaded.bytes,
  });

  scene.set("videoAssetId", asset._id);
  scene.set("videoStale", false);
  scene.status = "video_ready";
  await scene.save();

  await advanceScene(userId, projectId, scene._id.toString());

  return { assetId: asset._id.toString() };
}

/** Parks a scene/job in the manual hand-off state — shared by the plain manual provider and by the
 * automation provider's circuit-breaker fallback, so both produce an identical UI experience. */
export async function fallBackToManualVideo(
  scene: HydratedDocument<SceneDoc>,
  result: Extract<VideoGenerationResult, { status: "manual_pending" }>,
) {
  scene.set("videoTaskId", result.taskId);
  scene.set("pendingVideoPrompt", result.promptText);
  scene.set("pendingVideoInstructions", result.instructions);
  scene.status = "video_pending_manual";
  await scene.save();
}

async function loadCharacterReferenceImages(userId: string, characterIds: unknown[]) {
  const characters = await Character.find({ _id: { $in: characterIds }, userId }).lean();
  return characters
    .map((c) => {
      const front = c.sheetAssets?.find((s) => s.pose === "front-view");
      return front ? { url: (front.assetId as unknown as { url: string })?.url, description: c.name } : null;
    })
    .filter((r): r is { url: string; description: string } => !!r?.url);
}

/**
 * PDF Step 5 — Generate Videos. The only registered VideoProvider today (Google Flow) has no API —
 * see core/ai/providers/google/google-flow-video.ts — so this always resolves to `manual_pending`
 * and the job stays open until POST /api/scenes/:id/video/upload completes it. No Google account is
 * resolved here: assembling the hand-off prompt makes no API call. A future synchronous
 * (`status: "completed"`) provider registered in core/ai/registry.ts is handled too, via
 * completeSceneVideo above — nothing here needs to change when one is added.
 */
export async function processSceneVideoJob(bullJob: BullJob<BullJobData>): Promise<ProcessorResult> {
  return withJobLifecycle(bullJob, async (jobDoc) => {
    if (!jobDoc.sceneId) throw new Error("Job is missing sceneId");
    const [scene, project] = await Promise.all([
      Scene.findOne({ _id: jobDoc.sceneId, userId: jobDoc.userId }),
      Project.findOne({ _id: jobDoc.projectId, userId: jobDoc.userId }),
    ]);
    if (!scene) throw new Error("Scene not found");
    if (!project) throw new Error("Project not found");

    const characterReferenceImages = await loadCharacterReferenceImages(jobDoc.userId, scene.characterIds);

    const providerId = await getProviderOverride(jobDoc.userId, "video");
    const provider = getVideoProvider(providerId);
    const style = project.style === "Custom" ? (project.customStyleDescription ?? "Custom") : project.style;
    const templateOverride = await resolveActiveTemplate(jobDoc.userId, "scene_video");

    const result = await provider.generateVideo({
      sceneId: scene._id.toString(),
      characterReferenceImages,
      action: scene.visual,
      camera: scene.camera,
      lighting: "morning",
      emotion: scene.emotion,
      durationSeconds: 8,
      style,
      templateOverride,
    });

    if (result.status === "manual_pending") {
      await fallBackToManualVideo(scene, result);
      return {
        status: "manual_pending",
        taskId: result.taskId,
        promptText: result.promptText,
        instructions: result.instructions,
        characterReferenceImages,
      };
    }

    return completeSceneVideo(scene, jobDoc.userId, jobDoc.projectId.toString(), result);
  });
}
