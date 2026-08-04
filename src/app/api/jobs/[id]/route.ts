import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { getJob } from "@/modules/jobs/service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const job = await getJob(userId, id);
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ job });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to load job" }, { status: 500 });
  }
}
