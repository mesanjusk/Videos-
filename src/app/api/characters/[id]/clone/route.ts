import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { assignCharacterSchema } from "@/modules/characters/schema";
import { assignCharacterToProject } from "@/modules/characters/service";
import { getProject } from "@/modules/projects/service";

export const dynamic = "force-dynamic";

/** Links a library character into another project the user owns — the "character memory" reuse
 * flow, e.g. episode 2 of a series. No document is copied: the same character (face/outfit/voice/
 * style/prompt/version history) becomes usable in the target project's Scene Manager, so an edit
 * later applies everywhere it's used. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: characterId } = await params;

    const body = await request.json();
    const parsed = assignCharacterSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    const targetProject = await getProject(userId, parsed.data.targetProjectId);
    if (!targetProject) return NextResponse.json({ error: "Target project not found" }, { status: 404 });

    const result = await assignCharacterToProject(userId, characterId, parsed.data.targetProjectId);
    if (!result.ok) return NextResponse.json({ error: "Character not found" }, { status: 404 });

    return NextResponse.json({ character: result.character }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to add character to project" }, { status: 500 });
  }
}
