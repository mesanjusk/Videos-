import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { getScene } from "@/modules/scenes/service";
import { enqueueJob } from "@/modules/jobs/service";
import { findAccountWithFlowSession } from "@/modules/accounts/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Enqueues browser-automation-backed video generation (Module 4) instead of the manual hand-off —
 * only processed if a standalone worker.ts process is running (see
 * core/queue/worker-only-processors.ts); otherwise the job stays visibly "queued" on /queue until
 * one is. Requires at least one Google account with a connected Flow browser session
 * (Accounts page), checked here so the failure is immediate and clear rather than a job that can
 * never complete.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: sceneId } = await params;
    const scene = await getScene(userId, sceneId);
    if (!scene) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const account = await findAccountWithFlowSession(userId);
    if (!account) {
      return NextResponse.json(
        { error: "Connect a Google account's Flow browser session first, on the Accounts page." },
        { status: 400 },
      );
    }

    const job = await enqueueJob({
      userId,
      projectId: scene.projectId.toString(),
      sceneId,
      type: "scene_video_auto",
      payload: {},
    });

    return NextResponse.json({ job }, { status: 202 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to start automated video generation" }, { status: 500 });
  }
}
