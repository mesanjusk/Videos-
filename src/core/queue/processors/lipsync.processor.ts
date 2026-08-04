import type { Job as BullJob } from "bullmq";
import { withJobLifecycle, type BullJobData, type ProcessorResult } from "./helpers";
import { Scene } from "@/modules/scenes/models/Scene";
import { getLipSyncProvider } from "@/core/ai/registry";
import { getProviderOverride } from "@/modules/settings/service";

/**
 * PDF Step 7 — Lip Sync. Requires both a video clip and a voice track already generated for the
 * scene (Steps 5 and 6) — there's nothing to sync otherwise. Like `scene_video`, the only registered
 * `LipSyncProvider` today (`manual`) has no API, so this always resolves to `manual_pending` and the
 * job stays open until `POST /api/scenes/:id/lipsync/upload` completes it.
 */
export async function processLipSyncJob(bullJob: BullJob<BullJobData>): Promise<ProcessorResult> {
  return withJobLifecycle(bullJob, async (jobDoc) => {
    if (!jobDoc.sceneId) throw new Error("Job is missing sceneId");
    const scene = await Scene.findOne({ _id: jobDoc.sceneId, userId: jobDoc.userId }).populate("videoAssetId").populate("voiceAssetId");
    if (!scene) throw new Error("Scene not found");

    const video = scene.videoAssetId as unknown as { url: string } | undefined;
    const voice = scene.voiceAssetId as unknown as { url: string } | undefined;
    if (!video?.url) throw new Error("Generate this scene's video before lip-syncing it.");
    if (!voice?.url) throw new Error("Generate this scene's voice before lip-syncing it.");

    const providerId = await getProviderOverride(jobDoc.userId, "lipsync");
    const provider = getLipSyncProvider(providerId);

    const result = await provider.generateLipSync({
      sceneId: scene._id.toString(),
      videoUrl: video.url,
      voiceUrl: voice.url,
    });

    if (result.status === "manual_pending") {
      scene.set("lipSyncTaskId", result.taskId);
      scene.set("pendingLipSyncInstructions", result.instructions);
      scene.status = "lipsync_pending_manual";
      await scene.save();
      return {
        status: "manual_pending",
        taskId: result.taskId,
        instructions: result.instructions,
        videoUrl: video.url,
        voiceUrl: voice.url,
      };
    }

    // Reachable once an API-backed LipSyncProvider is registered — kept here so this processor
    // doesn't need to change when that happens, only core/ai/registry.ts does.
    throw new Error("Unexpected synchronous lip-sync result from a manual-handoff-only provider");
  });
}
