import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { deleteCharacter } from "@/modules/characters/service";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    await deleteCharacter(userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to delete character" }, { status: 500 });
  }
}
