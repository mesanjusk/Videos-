import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { addGoogleAccount, listGoogleAccounts } from "@/modules/accounts/service";
import { addGoogleAccountSchema } from "@/modules/accounts/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    const accounts = await listGoogleAccounts(userId);
    return NextResponse.json({ accounts });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to list accounts" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    const parsed = addGoogleAccountSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
    }
    const account = await addGoogleAccount({ userId, ...parsed.data });
    return NextResponse.json({ account: { ...account.toObject(), credentials: undefined } }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (err instanceof Error && /duplicate key/i.test(err.message)) {
      return NextResponse.json({ error: "That Google account is already connected" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to add account" }, { status: 500 });
  }
}
