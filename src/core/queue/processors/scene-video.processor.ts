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
import { checkVideoDuration } from "@/core/quality/checks";
import { QualityCheckFailedError } from "@/core/quality/errors";
import { resolveQualityTargets } from "@/core/production-engine/resolve-quality-targets";
import { getFeatureFlags } from "@/core/config/flags";
import { findAccountWithFlowSession } from "@/modules/accounts/service";
import { enqueueJob } from "@/modules/jobs/service";
import { ProductionProfile } from "@/modules/production-profiles/models/ProductionProfile";

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
  activeProfileId?: unknown,
) {
  const uploaded = await uploadVideoAsset(result.data, {
    folder: `projects/${projectId}/scenes/${scene._id.toString()}`,
    publicId: "video",
  });
  const actualDuration = result.durationSeconds ?? uploaded.durationSeconds;
  const qualityTargets = await resolveQualityTargets(activeProfileId, userId);
  const durationIssues = checkVideoDuration(actualDuration, qualityTargets.sceneVideoDuration.min, qualityTargets.sceneVideoDuration.max);
  if (durationIssues.length > 0) {
    // Escalated to "error" in this context only — this path is genuinely AI-generated (never a
    // human upload, see the docstring above), so an out-of-spec duration is worth retrying.
    throw new QualityCheckFailedError(durationIssues.map((i) => ({ ...i, severity: "error" })));
  }

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
    const promptTemplateOverrides = project.promptTemplateOverrides as Record<string, string> | undefined;
    const templateOverride = await resolveActiveTemplate(jobDoc.userId, "scene_video", promptTemplateOverrides?.scene_video);

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
      // Browser fallback: before parking this on a human, see whether the same provider can be
      // driven through its own website instead. This is the point of having a browser automation
      // subsystem in a video studio at all — a provider with no API is not the same thing as a
      // provider with no route.
      //
      // Enqueued rather than executed inline, deliberately: scene_video runs in the shared
      // processor registry, which the Vercel serverless tick also uses, and nothing reachable from
      // there may import Playwright. scene_video_auto is registered worker-only and already
      // handles the browser run — including degrading to this same manual hand-off if the site
      // fails, so the worst case is exactly today's behaviour, one queue hop later.
      const diverted = await tryBrowserFallback(jobDoc.userId, jobDoc.projectId, scene._id.toString(), project.activeProfileId);
      if (diverted) {
        return { status: "completed", divertedTo: "scene_video_auto", jobId: diverted, characterReferenceImages };
      }

      await fallBackToManualVideo(scene, result);
      return {
        status: "manual_pending",
        taskId: result.taskId,
        promptText: result.promptText,
        instructions: result.instructions,
        characterReferenceImages,
      };
    }

    return completeSceneVideo(scene, jobDoc.userId, jobDoc.projectId!.toString(), result, project.activeProfileId);
  });
}

/**
 * Diverts a manual hand-off to browser automation, when everything needed is actually in place.
 *
 * Returns the enqueued job id, or null — and null is the normal, expected answer. Every condition
 * below has to hold, and each is checked rather than assumed:
 *
 *  - the deployment enabled browser fallback (ENABLE_BROWSER_FALLBACK), or this production's
 *    profile opted in. Off by default: diverting a job that would have waited for a person into one
 *    that drives a browser is a behaviour change, and behaviour changes are opt-in.
 *  - a Google account with a connected Flow browser session exists. Without one there is nothing
 *    to sign in as, and the automation would only fail its way back to the manual hand-off.
 *
 * Never throws. A fallback that cannot be attempted must leave the scene exactly where it would
 * have been anyway — waiting for a human — not fail the job.
 */
async function tryBrowserFallback(
  userId: string,
  projectId: unknown,
  sceneId: string,
  activeProfileId: unknown,
): Promise<string | null> {
  try {
    let enabled = getFeatureFlags().browserFallback;
    if (!enabled && activeProfileId) {
      const profile = await ProductionProfile.findOne({ _id: activeProfileId, userId }).select("render.browserFallback").lean();
      enabled = Boolean((profile?.render as { browserFallback?: boolean } | undefined)?.browserFallback);
    }
    if (!enabled) return null;

    const account = await findAccountWithFlowSession(userId);
    if (!account) return null;

    const job = await enqueueJob({
      userId,
      projectId: projectId ? String(projectId) : undefined,
      sceneId,
      type: "scene_video_auto",
      payload: { divertedFrom: "scene_video" },
    });
    console.log(`[video] no API route for scene ${sceneId} — diverted to browser automation as job ${job._id}`);
    return job._id.toString();
  } catch (err) {
    console.error(`[video] browser fallback could not be attempted for scene ${sceneId}:`, err);
    return null;
  }
}
