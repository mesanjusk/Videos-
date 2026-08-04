import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { getProject } from "@/modules/projects/service";
import { enqueueJob } from "@/modules/jobs/service";

export const dynamic = "force-dynamic";

// This route only enqueues — the actual FFmpeg work runs inside /api/queue/tick's bounded worker.
// Render jobs (downloading every clip + encoding) are the one job type genuinely at risk of
// outrunning that tick's time budget on longer videos, especially on Vercel Hobby's short function
// timeout. If the tick's function is killed mid-render, BullMQ's lock expiry requeues the job
// (attempts: 3) rather than losing it, but that redoes the work from scratch. For projects long
// enough to matter, running the standalone `worker.ts` (ARCHITECTURE.md §7) somewhere with no
// per-invocation time limit is the real fix, not a bigger tick budget.

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: projectId } = await params;
    const project = await getProject(userId, projectId);
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const job = await enqueueJob({ userId, projectId, type: "render", payload: {} });
    return NextResponse.json({ job }, { status: 202 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to start render" }, { status: 500 });
  }
}
