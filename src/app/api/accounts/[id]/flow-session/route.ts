import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { saveFlowSessionSchema } from "@/modules/accounts/schema";
import { saveFlowSessionState, clearFlowSessionState } from "@/modules/accounts/service";

export const dynamic = "force-dynamic";

/** Connects this account's Google Flow browser session for the Browser Automation Engine — see
 * docs/MOVIE-STUDIO-ROADMAP.md Module 4. The operator logs into labs.google/flow manually once in a
 * local Playwright browser, exports `context.storageState()`, and pastes the JSON here. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: accountId } = await params;

    const body = await request.json();
    const parsed = saveFlowSessionSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    await saveFlowSessionState(userId, accountId, parsed.data.storageState);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to save the Flow session" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: accountId } = await params;
    await clearFlowSessionState(userId, accountId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to disconnect the Flow session" }, { status: 500 });
  }
}
