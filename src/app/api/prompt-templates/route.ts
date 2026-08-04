import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { listTemplatesForUser } from "@/modules/prompt-templates/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    const templates = await listTemplatesForUser(userId);
    return NextResponse.json({ templates });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to list prompt templates" }, { status: 500 });
  }
}
