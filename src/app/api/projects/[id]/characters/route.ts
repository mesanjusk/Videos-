import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { getProject } from "@/modules/projects/service";
import { createCharacter, listCharacters } from "@/modules/characters/service";
import { createCharacterSchema } from "@/modules/characters/schema";
import { enqueueJob } from "@/modules/jobs/service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: projectId } = await params;
    const characters = await listCharacters(userId, projectId);
    return NextResponse.json({ characters });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to list characters" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: projectId } = await params;
    const project = await getProject(userId, projectId);
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await request.json();
    const parsed = createCharacterSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    const character = await createCharacter(userId, projectId, parsed.data);
    const job = await enqueueJob({
      userId,
      projectId,
      characterId: character._id.toString(),
      type: "character_image",
      payload: {},
    });

    return NextResponse.json({ character, job }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to create character" }, { status: 500 });
  }
}
