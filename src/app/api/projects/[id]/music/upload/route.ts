import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { getProject, setProjectMusic } from "@/modules/projects/service";
import { Asset } from "@/modules/assets/models/Asset";
import { connectToDatabase } from "@/core/db/mongoose";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  url: z.string().url(),
  publicId: z.string().min(1),
  durationSeconds: z.number().positive().max(600).optional(),
  bytes: z.number().nonnegative().optional(),
});

/** Records a directly-uploaded music file (already on Cloudinary) as the project's background track. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: projectId } = await params;
    const project = await getProject(userId, projectId);
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await request.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    await connectToDatabase();
    const asset = await Asset.create({
      userId,
      projectId,
      kind: "music",
      cloudinaryPublicId: parsed.data.publicId,
      url: parsed.data.url,
      durationSeconds: parsed.data.durationSeconds,
      bytes: parsed.data.bytes,
    });

    await setProjectMusic(userId, projectId, asset._id.toString());

    return NextResponse.json({ asset }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to save music" }, { status: 500 });
  }
}
