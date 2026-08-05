import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { getBackground } from "@/modules/backgrounds/service";
import { getSignedUploadParams } from "@/core/storage/cloudinary";

export const dynamic = "force-dynamic";

/** Signed params for the browser to upload a user-supplied background image directly to Cloudinary. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: backgroundId } = await params;
    const background = await getBackground(userId, backgroundId);
    if (!background) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const signed = getSignedUploadParams(`projects/${background.projectId.toString()}/backgrounds/${backgroundId}`);
    return NextResponse.json(signed);
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to prepare upload" }, { status: 500 });
  }
}
