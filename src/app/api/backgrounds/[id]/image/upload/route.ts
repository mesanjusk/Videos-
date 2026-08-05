import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { getBackground, setBackgroundCustomImage } from "@/modules/backgrounds/service";
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

/** Records a directly-uploaded image (already on Cloudinary) as this background's image. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: backgroundId } = await params;
    const background = await getBackground(userId, backgroundId);
    if (!background) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    await connectToDatabase();
    const asset = await Asset.create({
      userId,
      projectId: background.projectId,
      kind: "image",
      cloudinaryPublicId: parsed.data.publicId,
      url: parsed.data.url,
      width: parsed.data.width,
      height: parsed.data.height,
      bytes: parsed.data.bytes,
    });

    const updated = await setBackgroundCustomImage(userId, backgroundId, asset._id.toString());

    return NextResponse.json({ background: updated, asset }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to save image" }, { status: 500 });
  }
}
