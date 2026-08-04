import type { Job as BullJob } from "bullmq";
import { withJobLifecycle, type BullJobData, type ProcessorResult } from "./helpers";
import { Project } from "@/modules/projects/models/Project";
import { Scene } from "@/modules/scenes/models/Scene";
import { Character } from "@/modules/characters/models/Character";
import { getVideoProvider } from "@/core/ai/registry";
import { resolveActiveTemplate } from "@/modules/prompt-templates/service";
import { getProviderOverride } from "@/modules/settings/service";

/**
 * PDF Step 5 — Generate Videos. The only registered VideoProvider today (Google Flow) has no API —
 * see core/ai/providers/google/google-flow-video.ts — so this always resolves to `manual_pending`
 * and the job stays open until POST /api/scenes/:id/video/upload completes it. No Google account is
 * resolved here: assembling the hand-off prompt makes no API call.
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

    const characters = await Character.find({ _id: { $in: scene.characterIds }, userId: jobDoc.userId }).lean();
    const characterReferenceImages = characters
      .map((c) => {
        const front = c.sheetAssets?.find((s) => s.pose === "front-view");
        return front ? { url: (front.assetId as unknown as { url: string })?.url, description: c.name } : null;
      })
      .filter((r): r is { url: string; description: string } => !!r?.url);

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
      scene.set("videoTaskId", result.taskId);
      scene.set("pendingVideoPrompt", result.promptText);
      scene.set("pendingVideoInstructions", result.instructions);
      scene.status = "video_pending_manual";
      await scene.save();
      return {
        status: "manual_pending",
        taskId: result.taskId,
        promptText: result.promptText,
        instructions: result.instructions,
        characterReferenceImages,
      };
    }

    // Reachable once an API-backed VideoProvider is registered (ARCHITECTURE.md §2) — kept here so
    // this processor doesn't need to change when that happens, only core/ai/registry.ts does.
    throw new Error("Unexpected synchronous video result from a manual-handoff-only provider");
  });
}
