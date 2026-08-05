import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { requestCancelBrowserTask } from "@/modules/browser-automation/service";

export const dynamic = "force-dynamic";

/** Cancels a still-queued run outright (same "queued only" rule as the existing Scene Queue's
 * cancelJob); for a run already executing, sets the cooperative flag the worker polls instead. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const run = await requestCancelBrowserTask(userId, id);
    if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ run });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to cancel browser task" }, { status: 500 });
  }
}
