import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { cancelJob, getJob } from "@/modules/jobs/service";
import { checkStalled, describeStall } from "@/modules/jobs/stall";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const job = await getJob(userId, id);
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // A job that has stopped moving is reported as such rather than left to look like progress —
    // the poller has no other way to tell "still working" from "nothing is working on this".
    const report = checkStalled(job);
    return NextResponse.json({
      job: { ...job, stalled: report.stalled, stalledReason: describeStall(job, report) },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to load job" }, { status: 500 });
  }
}

/** Cancels a job still waiting in the queue — see modules/jobs/service.ts's cancelJob() for why only "queued" jobs qualify. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const job = await cancelJob(userId, id);
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ job });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (err instanceof Error) return NextResponse.json({ error: err.message }, { status: 400 });
    return NextResponse.json({ error: "Failed to cancel job" }, { status: 500 });
  }
}
