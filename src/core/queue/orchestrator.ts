import { connectToDatabase } from "@/core/db/mongoose";
import { Project } from "@/modules/projects/models/Project";
import { Scene } from "@/modules/scenes/models/Scene";
import { Character } from "@/modules/characters/models/Character";
import { Background } from "@/modules/backgrounds/models/Background";
import { Job } from "@/modules/jobs/models/Job";
import { Asset } from "@/modules/assets/models/Asset";
import { enqueueJob } from "@/modules/jobs/service";
import { completeProductionRun } from "@/modules/production-runs/service";

/**
 * Full-automation auto-chain (`Project.pipelineMode === "full"`). Every function below is a no-op
 * in "semi"/"manual" mode — the app's original behavior of every step being user-triggered is
 * unchanged unless a project opts into "full".
 *
 * This only chains what's genuinely safe without new human judgment:
 *  - Assigning a scene's characters/background once material exists for the first time (all ready
 *    characters + the first ready background — a blunt heuristic, not per-scene curation; that's
 *    the tradeoff full automation makes instead of stalling for a human to assign each scene).
 *  - scene_image -> scene_video -> voice -> lipsync, each only once its prerequisite is ready.
 *  - render -> thumbnail once every scene has reached a terminal state.
 * It never invents a Character/Background from scratch (their spec needs real creative input the
 * story step doesn't produce — age/body/face/clothes/etc.) and never proceeds past a manual
 * hand-off (video/lipsync) on its own — neither has a free API to call, a human still runs those;
 * the chain resumes automatically once that human uploads the result.
 */

async function isFullMode(userId: string, projectId: string): Promise<boolean> {
  await connectToDatabase();
  const project = await Project.findOne({ _id: projectId, userId }).select("pipelineMode").lean();
  return project?.pipelineMode === "full";
}

const IN_FLIGHT_STATUSES = new Set(["image_queued", "video_pending_manual", "voice_queued", "lipsync_pending_manual"]);

/** Enqueues the single next step for one scene, if it's ready for one and nothing is already in flight. */
export async function advanceScene(userId: string, projectId: string, sceneId: string): Promise<void> {
  if (!(await isFullMode(userId, projectId))) return;
  await connectToDatabase();
  const scene = await Scene.findOne({ _id: sceneId, userId, projectId });
  if (!scene || IN_FLIGHT_STATUSES.has(scene.status ?? "")) return;

  const hasDialogue = !!scene.dialogue?.trim();

  if (!scene.imageAssetId && scene.characterIds.length > 0 && scene.backgroundId) {
    scene.status = "image_queued"; // matches POST /api/scenes/:id/image so the Scene Manager's spinner shows up
    await scene.save();
    await enqueueJob({ userId, projectId, sceneId, type: "scene_image", payload: {} });
    return;
  }
  if (scene.imageAssetId && !scene.videoAssetId) {
    await enqueueJob({ userId, projectId, sceneId, type: "scene_video", payload: {} });
    return;
  }
  if (scene.videoAssetId && hasDialogue && !scene.voiceAssetId) {
    await enqueueJob({ userId, projectId, sceneId, type: "voice", payload: {} });
    return;
  }
  if (scene.videoAssetId && scene.voiceAssetId && hasDialogue && !scene.lipSyncAssetId) {
    await enqueueJob({ userId, projectId, sceneId, type: "lipsync", payload: {} });
    return;
  }

  // Nothing left to do for this scene — see if the whole project is ready to render.
  await maybeEnqueueRender(userId, projectId);
}

/** Called after a character_image or background_image job completes — assigns and kicks off any scenes that were waiting on it. */
export async function onCharacterOrBackgroundReady(userId: string, projectId: string): Promise<void> {
  if (!(await isFullMode(userId, projectId))) return;
  await connectToDatabase();

  const [readyCharacters, readyBackground] = await Promise.all([
    // Includes characters reused from the library (usedInProjectIds), not just ones created
    // directly in this project.
    Character.find({
      userId,
      $or: [{ projectId }, { usedInProjectIds: projectId }],
      "sheetAssets.0": { $exists: true },
    })
      .select("_id")
      .lean(),
    Background.findOne({ userId, projectId, assetId: { $exists: true } })
      .select("_id")
      .lean(),
  ]);
  if (readyCharacters.length === 0 || !readyBackground) return;

  const scenes = await Scene.find({ userId, projectId, imageAssetId: { $exists: false } });
  for (const scene of scenes) {
    let changed = false;
    if (scene.characterIds.length === 0) {
      scene.characterIds = readyCharacters.map((c) => c._id);
      changed = true;
    }
    if (!scene.backgroundId) {
      scene.backgroundId = readyBackground._id;
      changed = true;
    }
    if (changed) await scene.save();
    await advanceScene(userId, projectId, scene._id.toString());
  }
}

async function maybeEnqueueRender(userId: string, projectId: string): Promise<void> {
  const project = await Project.findOne({ _id: projectId, userId }).select("finalVideoAssetId");
  if (!project || project.finalVideoAssetId) return; // full mode renders once automatically, not on every edit

  const scenes = await Scene.find({ userId, projectId }).select("dialogue videoAssetId lipSyncAssetId");
  if (scenes.length === 0) return;
  const allTerminal = scenes.every((s) => !!s.videoAssetId && (!s.dialogue?.trim() || !!s.lipSyncAssetId));
  if (!allTerminal) return;

  const inFlight = await Job.exists({ userId, projectId, type: "render", status: { $in: ["queued", "running"] } });
  if (inFlight) return;

  await enqueueJob({ userId, projectId, type: "render", payload: {} });
}

/** Called after a render job completes successfully. */
export async function onRenderCompleted(userId: string, projectId: string): Promise<void> {
  // Finalizes any in-progress ProductionRun for this project (Module 6) — a no-op for projects
  // not created from a Production Profile (completeProductionRun finds nothing and returns null).
  // Runs regardless of pipelineMode since a profile-driven project is always "full".
  const [failedScenes, assets, jobs] = await Promise.all([
    Scene.find({ userId, projectId, status: "failed" }).select("_id").lean(),
    Asset.find({ userId, projectId }).select("_id").lean(),
    Job.find({ userId, projectId }).select("attempts").lean(),
  ]);
  const retryCount = jobs.reduce((sum, j) => sum + Math.max(0, (j.attempts ?? 1) - 1), 0);
  await completeProductionRun(userId, projectId, {
    retryCount,
    failedSceneIds: failedScenes.map((s) => s._id.toString()),
    generatedAssetIds: assets.map((a) => a._id.toString()),
  }).catch(() => null);

  if (!(await isFullMode(userId, projectId))) return;
  await enqueueJob({ userId, projectId, type: "thumbnail", payload: {} });
}
