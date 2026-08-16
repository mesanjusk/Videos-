import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { createApiToken, listApiTokens } from "@/modules/api-tokens/service";
import { createApiTokenSchema } from "@/modules/api-tokens/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    const tokens = await listApiTokens(userId);
    return NextResponse.json({ tokens });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to list API tokens" }, { status: 500 });
  }
}

/** Returns the raw token in the response body exactly once — the caller (Settings UI) must show/copy
 * it immediately; it can never be retrieved again (see modules/api-tokens/service.ts#createApiToken). */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    const parsed = createApiTokenSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    const { token, record } = await createApiToken(userId, parsed.data);
    return NextResponse.json({ token, record }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to create API token" }, { status: 500 });
  }
}
