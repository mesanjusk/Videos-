import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { retryJob } from "@/modules/jobs/service";

export const dynamic = "force-dynamic";
// enqueueJob() runs a queue tick in-process via after() — same budget as /api/queue/tick.
export const maxDuration = 60;

/** Runs a failed step again. See modules/jobs/service.ts#retryJob for why this creates a new job. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const job = await retryJob(userId, id);
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ jobId: job._id.toString() }, { status: 202 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (err instanceof Error) return NextResponse.json({ error: err.message }, { status: 400 });
    return NextResponse.json({ error: "Failed to run that step again" }, { status: 500 });
  }
}
