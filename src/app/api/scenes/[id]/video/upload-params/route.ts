import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { getScene } from "@/modules/scenes/service";
import { getSignedUploadParams } from "@/core/storage/cloudinary";

export const dynamic = "force-dynamic";

/** Signed params for the browser to upload a Google-Flow-generated clip directly to Cloudinary. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: sceneId } = await params;
    const scene = await getScene(userId, sceneId);
    if (!scene) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const signed = getSignedUploadParams(`projects/${scene.projectId.toString()}/scenes/${sceneId}`);
    return NextResponse.json(signed);
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to prepare upload" }, { status: 500 });
  }
}
