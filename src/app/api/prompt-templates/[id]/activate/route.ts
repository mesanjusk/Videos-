import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { activateTemplate } from "@/modules/prompt-templates/service";

export const dynamic = "force-dynamic";

/** Makes a saved preset the one used for generation in its scope, demoting whichever preset was active before. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const template = await activateTemplate(userId, id);
    if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ template });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to activate preset" }, { status: 500 });
  }
}
