import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { duplicateScene } from "@/modules/scenes/service";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const scene = await duplicateScene(userId, id);
    if (!scene) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ scene }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to duplicate scene" }, { status: 500 });
  }
}
