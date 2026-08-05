import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { getCharacter } from "@/modules/characters/service";
import { getSignedUploadParams } from "@/core/storage/cloudinary";

export const dynamic = "force-dynamic";

/** Signed params for the browser to upload a user-supplied character reference image directly to Cloudinary. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: characterId } = await params;
    const character = await getCharacter(userId, characterId);
    if (!character) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const signed = getSignedUploadParams(`projects/${character.projectId.toString()}/characters/${characterId}`);
    return NextResponse.json(signed);
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to prepare upload" }, { status: 500 });
  }
}
