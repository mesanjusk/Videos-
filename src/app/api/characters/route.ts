import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { createCharacter, listCharacterLibrary } from "@/modules/characters/service";
import { createCharacterSchema } from "@/modules/characters/schema";

export const dynamic = "force-dynamic";

/** The permanent Character Library — every character the user owns, across every project. */
export async function GET() {
  try {
    const userId = await requireUserId();
    const characters = await listCharacterLibrary(userId);
    return NextResponse.json({ characters });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to list characters" }, { status: 500 });
  }
}

/** Creates a character directly in the library, with no project — generate its sheet later, or
 * assign it into a project first via /api/characters/:id/clone. */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    const parsed = createCharacterSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    const character = await createCharacter(userId, parsed.data);
    return NextResponse.json({ character }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to create character" }, { status: 500 });
  }
}
