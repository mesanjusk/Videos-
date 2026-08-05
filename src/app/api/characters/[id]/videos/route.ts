import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { listCharacterVideos } from "@/modules/characters/service";

export const dynamic = "force-dynamic";

/** Every finished video from every project this character has appeared in — the Character Library's "Previous Videos". */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const videos = await listCharacterVideos(userId, id);
    return NextResponse.json({ videos });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to load videos" }, { status: 500 });
  }
}
