import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { createBrowserSessionSchema } from "@/modules/browser-automation/schema";
import { createBrowserSession, listBrowserSessions } from "@/modules/browser-automation/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    const sessions = await listBrowserSessions(userId);
    return NextResponse.json({ sessions });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to list browser sessions" }, { status: 500 });
  }
}

/** Persists a Playwright `storageState()` export the operator captured out-of-band (manual login,
 * same rule Module 4 established — this endpoint never performs a login flow itself). */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    const parsed = createBrowserSessionSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    const session = await createBrowserSession(userId, parsed.data);
    return NextResponse.json({ session }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to save browser session" }, { status: 500 });
  }
}
