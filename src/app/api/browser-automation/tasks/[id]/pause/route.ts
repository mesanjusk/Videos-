import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { requestPauseBrowserTask } from "@/modules/browser-automation/service";

export const dynamic = "force-dynamic";

/** Sets a cooperative pause flag the worker's `browser_task` processor polls — see
 * modules/browser-automation/service.ts#requestPauseBrowserTask for why this can't call the
 * TaskEngine directly (it runs in a separate worker process this Vercel route never imports). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const run = await requestPauseBrowserTask(userId, id);
    if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ run });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to request pause" }, { status: 500 });
  }
}
