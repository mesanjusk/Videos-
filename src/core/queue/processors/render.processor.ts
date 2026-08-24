import { readFile } from "node:fs/promises";
import type { Job as BullJob } from "bullmq";
import { withJobLifecycle, type BullJobData, type ProcessorResult } from "./helpers";
import { Project } from "@/modules/projects/models/Project";
import { Scene } from "@/modules/scenes/models/Scene";
import { Asset } from "@/modules/assets/models/Asset";
import { getRenderProvider } from "@/core/render";
import { ProductionProfile } from "@/modules/production-profiles/models/ProductionProfile";
import { uploadVideoAsset } from "@/core/storage/cloudinary";
import { onRenderCompleted } from "@/core/queue/orchestrator";
import { checkImageResolution, TARGET_FINAL_VIDEO } from "@/core/quality/checks";

/** PDF Step 9 — Editing. Joins every scene with a generated video clip into the final export. */
export async function processRenderJob(bullJob: BullJob<BullJobData>): Promise<ProcessorResult> {
  return withJobLifecycle(bullJob, async (jobDoc) => {
    const project = await Project.findOne({ _id: jobDoc.projectId, userId: jobDoc.userId });
    if (!project) throw new Error("Project not found");

    const scenes = await Scene.find({ projectId: jobDoc.projectId, userId: jobDoc.userId })
      .sort({ index: 1 })
      .populate("videoAssetId")
      .populate("voiceAssetId")
      .populate("lipSyncAssetId")
      .lean();

    const renderable = scenes.filter(
      (s) => (s.lipSyncAssetId && typeof s.lipSyncAssetId === "object") || (s.videoAssetId && typeof s.videoAssetId === "object"),
    );
    if (renderable.length === 0) {
      throw new Error("No scenes have a generated video yet — generate at least one scene's video first.");
    }

    const musicAsset = project.musicAssetId
      ? await Asset.findOne({ _id: project.musicAssetId, userId: jobDoc.userId }).lean()
      : null;

    project.status = "rendering";
    await project.save();

    // Which renderer this production wants. Defaults to FFmpeg — the renderer every project has
    // always used — and degrades back to it if the requested one is unavailable, so an existing
    // project's render is byte-for-byte the same path it was before the merge.
    const profile = project.activeProfileId
      ? await ProductionProfile.findOne({ _id: project.activeProfileId, userId: jobDoc.userId }).select("render.renderer").lean()
      : null;
    const renderer = getRenderProvider((profile?.render as { renderer?: string } | undefined)?.renderer);

    const compose = await renderer.render({
      scenes: renderable.map((s) => {
        // Prefer the lip-synced clip when one exists — its own audio track already has the
        // narration baked in, so the separate voice track (if any) is intentionally left unused.
        const lipSynced = !!(s.lipSyncAssetId && typeof s.lipSyncAssetId === "object");
        return {
          index: s.index,
          videoUrl: lipSynced
            ? (s.lipSyncAssetId as unknown as { url: string }).url
            : (s.videoAssetId as unknown as { url: string }).url,
          voiceUrl:
            !lipSynced && s.voiceAssetId && typeof s.voiceAssetId === "object"
              ? (s.voiceAssetId as unknown as { url: string }).url
              : undefined,
          useEmbeddedAudio: lipSynced,
          dialogue: s.dialogue,
        };
      }),
      musicUrl: musicAsset?.url,
      watermarkUrl: project.watermarkImageUrl ?? undefined,
    });

    try {
      const fileBuffer = await readFile(compose.filePath);
      const uploaded = await uploadVideoAsset(fileBuffer, {
        folder: `projects/${jobDoc.projectId}/final`,
        publicId: "final",
      });

      const asset = await Asset.create({
        userId: jobDoc.userId,
        projectId: jobDoc.projectId,
        kind: "final_video",
        cloudinaryPublicId: uploaded.publicId,
        url: uploaded.url,
        durationSeconds: uploaded.durationSeconds ?? compose.durationSeconds,
        bytes: uploaded.bytes,
      });

      project.set("finalVideoAssetId", asset._id);
      project.status = "done";
      project.completionPercent = 100;
      await project.save();

      await onRenderCompleted(jobDoc.userId, jobDoc.projectId!.toString());

      // Warning-only: compose.ts's own ffmpeg filter graph deterministically forces this
      // resolution, so a mismatch here would mean a pipeline bug, not a re-runnable generation
      // issue — surfaced for visibility, never auto-retried (re-rendering is the most expensive
      // job type in the app).
      const qualityIssues = checkImageResolution(uploaded, TARGET_FINAL_VIDEO).map((i) => ({ ...i, severity: "warning" as const }));
      if (qualityIssues.length > 0) console.error(`[quality] final render for project ${jobDoc.projectId}:`, qualityIssues);

      // Anything the renderer declined to do is reported, never dropped silently — an overlay that
      // did not composite is something the operator needs to know about even though the video is fine.
      if (compose.warnings.length > 0) console.warn(`[render] project ${jobDoc.projectId}:`, compose.warnings);

      return {
        assetId: asset._id.toString(),
        durationSeconds: compose.durationSeconds,
        renderer: compose.renderer,
        renderWarnings: compose.warnings,
        qualityIssues,
      };
    } finally {
      await compose.cleanup();
    }
  });
}
