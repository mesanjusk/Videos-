import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { getScene } from "@/modules/scenes/service";
import { enqueueJob } from "@/modules/jobs/service";

export const dynamic = "force-dynamic";
// enqueueJob() runs a queue tick in-process via after() before this function is allowed to freeze —
// give it the same budget as /api/queue/tick.
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: sceneId } = await params;
    const scene = await getScene(userId, sceneId);
    if (!scene) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!scene.videoAssetId) return NextResponse.json({ error: "Generate this scene's video first" }, { status: 409 });
    if (!scene.voiceAssetId) return NextResponse.json({ error: "Generate this scene's voice first" }, { status: 409 });

    const job = await enqueueJob({
      userId,
      projectId: scene.projectId.toString(),
      sceneId,
      type: "lipsync",
      payload: {},
    });

    return NextResponse.json({ job }, { status: 202 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to start lip-sync generation" }, { status: 500 });
  }
}
