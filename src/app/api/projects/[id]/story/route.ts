import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { getProject } from "@/modules/projects/service";
import { enqueueJob } from "@/modules/jobs/service";

export const dynamic = "force-dynamic";
// enqueueJob() runs a queue tick in-process via after() before this function is allowed to freeze —
// give it the same budget as /api/queue/tick.
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: projectId } = await params;
    const project = await getProject(userId, projectId);
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const job = await enqueueJob({ userId, projectId, type: "story", payload: {} });
    return NextResponse.json({ job }, { status: 202 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to start story generation" }, { status: 500 });
  }
}
