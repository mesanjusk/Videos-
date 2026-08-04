import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { getScene } from "@/modules/scenes/service";
import { completeSceneLipSyncUploadSchema } from "@/modules/scenes/schema";
import { getLipSyncProvider } from "@/core/ai/registry";
import { Asset } from "@/modules/assets/models/Asset";
import { Job } from "@/modules/jobs/models/Job";
import { connectToDatabase } from "@/core/db/mongoose";
import { advanceScene } from "@/core/queue/orchestrator";

export const dynamic = "force-dynamic";

/**
 * Completes the lip-sync manual hand-off (mirrors /api/scenes/:id/video/upload): the operator
 * already uploaded the synced clip straight to Cloudinary using the signed params from the
 * upload-params route; this just records it as an Asset, flips the Scene to lipsync_ready, and
 * marks the manual_pending Job completed.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: sceneId } = await params;
    const scene = await getScene(userId, sceneId);
    if (!scene) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await request.json();
    const parsed = completeSceneLipSyncUploadSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    if (scene.lipSyncTaskId !== parsed.data.taskId) {
      return NextResponse.json({ error: "This upload doesn't match the current lip-sync task" }, { status: 409 });
    }

    const lipSyncProvider = getLipSyncProvider();
    const completed = await lipSyncProvider.completeManualUpload?.(parsed.data.taskId, parsed.data.url);

    await connectToDatabase();
    const asset = await Asset.create({
      userId,
      projectId: scene.projectId,
      kind: "video",
      cloudinaryPublicId: parsed.data.publicId,
      url: completed?.videoUrl ?? parsed.data.url,
      durationSeconds: completed?.durationSeconds ?? parsed.data.durationSeconds,
      bytes: parsed.data.bytes,
    });

    scene.set("lipSyncAssetId", asset._id);
    scene.set("lipSyncStale", false);
    scene.status = "lipsync_ready";
    await scene.save();

    await Job.updateOne(
      { userId, sceneId, type: "lipsync", status: "manual_pending", "result.taskId": parsed.data.taskId },
      { $set: { status: "completed", progress: 100, "result.assetId": asset._id.toString() } },
    );

    await advanceScene(userId, scene.projectId.toString(), sceneId);

    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to complete upload" }, { status: 500 });
  }
}
