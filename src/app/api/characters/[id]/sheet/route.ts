import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { getCharacter } from "@/modules/characters/service";
import { enqueueJob } from "@/modules/jobs/service";

export const dynamic = "force-dynamic";
// enqueueJob() runs a queue tick in-process via after() before this function is allowed to freeze —
// give it the same budget as /api/queue/tick.
export const maxDuration = 60;

/** Regenerates a character's turnaround sheet — used for both the first generation and "Regenerate". */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: characterId } = await params;
    const character = await getCharacter(userId, characterId);
    if (!character) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // AI sheet generation needs a project (for style + Cloudinary folder) — a library-only
    // character with no home project yet must be assigned to one first, or use "upload my own image".
    if (!character.projectId) {
      return NextResponse.json(
        { error: "Assign this character to a project before generating an AI sheet" },
        { status: 400 },
      );
    }

    const job = await enqueueJob({
      userId,
      projectId: character.projectId.toString(),
      characterId,
      type: "character_image",
      payload: {},
    });

    return NextResponse.json({ job }, { status: 202 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to start generation" }, { status: 500 });
  }
}
