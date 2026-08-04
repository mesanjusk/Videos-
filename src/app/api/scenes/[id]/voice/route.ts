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
    if (!scene.dialogue?.trim()) {
      return NextResponse.json({ error: "This scene has no dialogue to voice" }, { status: 400 });
    }

    const job = await enqueueJob({
      userId,
      projectId: scene.projectId.toString(),
      sceneId,
      type: "voice",
      payload: {},
    });

    return NextResponse.json({ job }, { status: 202 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to start voice generation" }, { status: 500 });
  }
}
