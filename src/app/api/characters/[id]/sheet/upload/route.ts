import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { getCharacter, setCharacterCustomImage } from "@/modules/characters/service";
import { Asset } from "@/modules/assets/models/Asset";
import { connectToDatabase } from "@/core/db/mongoose";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  url: z.string().url(),
  publicId: z.string().min(1),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  bytes: z.number().nonnegative().optional(),
});

/** Records a directly-uploaded image (already on Cloudinary) as this character's reference sheet. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: characterId } = await params;
    const character = await getCharacter(userId, characterId);
    if (!character) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!character.projectId) {
      return NextResponse.json({ error: "Assign this character to a project before uploading an image" }, { status: 400 });
    }

    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    await connectToDatabase();
    const asset = await Asset.create({
      userId,
      projectId: character.projectId,
      kind: "image",
      cloudinaryPublicId: parsed.data.publicId,
      url: parsed.data.url,
      width: parsed.data.width,
      height: parsed.data.height,
      bytes: parsed.data.bytes,
    });

    const updated = await setCharacterCustomImage(userId, characterId, asset._id.toString());

    return NextResponse.json({ character: updated, asset }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to save image" }, { status: 500 });
  }
}
