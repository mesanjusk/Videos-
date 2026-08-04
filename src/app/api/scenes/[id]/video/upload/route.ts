import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { getScene } from "@/modules/scenes/service";
import { completeSceneVideoUploadSchema } from "@/modules/scenes/schema";
import { getVideoProvider } from "@/core/ai/registry";
import { Asset } from "@/modules/assets/models/Asset";
import { Job } from "@/modules/jobs/models/Job";
import { connectToDatabase } from "@/core/db/mongoose";

export const dynamic = "force-dynamic";

/**
 * Completes the Google Flow manual hand-off (ARCHITECTURE.md §2): the operator already uploaded the
 * clip straight to Cloudinary using the signed params from the upload-params route; this just
 * records it as an Asset, flips the Scene to video_ready, and marks the manual_pending Job completed.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: sceneId } = await params;
    const scene = await getScene(userId, sceneId);
    if (!scene) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await request.json();
    const parsed = completeSceneVideoUploadSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    if (scene.videoTaskId !== parsed.data.taskId) {
      return NextResponse.json({ error: "This upload doesn't match the current video task" }, { status: 409 });
    }

    const videoProvider = getVideoProvider();
    const completed = await videoProvider.completeManualUpload?.(parsed.data.taskId, parsed.data.url);

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

    scene.set("videoAssetId", asset._id);
    scene.set("videoStale", false);
    scene.status = "video_ready";
    await scene.save();

    await Job.updateOne(
      { userId, sceneId, type: "scene_video", status: "manual_pending", "result.taskId": parsed.data.taskId },
      { $set: { status: "completed", progress: 100, "result.assetId": asset._id.toString() } },
    );

    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to complete upload" }, { status: 500 });
  }
}
