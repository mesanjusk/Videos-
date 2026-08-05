import type { Job as BullJob } from "bullmq";
import { withJobLifecycle, type BullJobData, type ProcessorResult } from "./helpers";
import { Project } from "@/modules/projects/models/Project";
import { Scene } from "@/modules/scenes/models/Scene";
import { Character } from "@/modules/characters/models/Character";
import { findAccountWithFlowSession, getDecryptedFlowSessionState } from "@/modules/accounts/service";
import { resolveActiveTemplate } from "@/modules/prompt-templates/service";
import { generateVideoViaFlowAutomation } from "@/core/ai/providers/google/google-flow-automated";
import { completeSceneVideo, fallBackToManualVideo } from "./scene-video.processor";

/**
 * Browser-automation-backed scene video generation (Module 4) — the `scene_video_auto` job type,
 * deliberately its own processor and queue rather than an option inside `scene_video`, so this file
 * (the only importer of the Playwright-based provider) is reachable only from worker.ts's
 * worker-only registry — never core/queue/processors/index.ts, which the Vercel serverless
 * `/api/queue/tick` route also uses. See core/queue/worker-only-processors.ts.
 *
 * If the user hasn't connected any Google account's Flow browser session
 * (modules/accounts/service.ts#findAccountWithFlowSession), this job fails outright rather than
 * silently falling back — POST /api/scenes/:id/video/auto already checks for a connected session
 * before enqueueing, so reaching here with none connected means it was disconnected in between.
 */
export async function processSceneVideoAutoJob(bullJob: BullJob<BullJobData>): Promise<ProcessorResult> {
  return withJobLifecycle(bullJob, async (jobDoc) => {
    if (!jobDoc.sceneId) throw new Error("Job is missing sceneId");
    const [scene, project] = await Promise.all([
      Scene.findOne({ _id: jobDoc.sceneId, userId: jobDoc.userId }),
      Project.findOne({ _id: jobDoc.projectId, userId: jobDoc.userId }),
    ]);
    if (!scene) throw new Error("Scene not found");
    if (!project) throw new Error("Project not found");

    const account = await findAccountWithFlowSession(jobDoc.userId);
    if (!account) throw new Error("No Google account has a connected Flow browser session");
    const storageStateJson = await getDecryptedFlowSessionState(jobDoc.userId, account.accountId);
    if (!storageStateJson) throw new Error("Flow session for the selected account could not be decrypted");
    jobDoc.set("googleAccountId", account.accountId);
    await jobDoc.save();

    const characters = await Character.find({ _id: { $in: scene.characterIds }, userId: jobDoc.userId }).lean();
    const characterReferenceImages = characters
      .map((c) => {
        const front = c.sheetAssets?.find((s) => s.pose === "front-view");
        return front ? { url: (front.assetId as unknown as { url: string })?.url, description: c.name } : null;
      })
      .filter((r): r is { url: string; description: string } => !!r?.url);

    const style = project.style === "Custom" ? (project.customStyleDescription ?? "Custom") : project.style;
    const templateOverride = await resolveActiveTemplate(jobDoc.userId, "scene_video");

    const result = await generateVideoViaFlowAutomation(
      {
        sceneId: scene._id.toString(),
        characterReferenceImages,
        action: scene.visual,
        camera: scene.camera,
        lighting: "morning",
        emotion: scene.emotion,
        durationSeconds: 8,
        style,
        templateOverride,
      },
      storageStateJson,
    );

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
