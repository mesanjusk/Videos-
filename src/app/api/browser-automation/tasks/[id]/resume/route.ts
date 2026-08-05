import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { resumeBrowserTask } from "@/modules/browser-automation/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // may enqueue a fresh browser_task Job + in-process tick

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const run = await resumeBrowserTask(userId, id);
    if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ run });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to resume browser task" }, { status: 500 });
  }
}
