import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { getProject } from "@/modules/projects/service";
import { getSignedUploadParams } from "@/core/storage/cloudinary";

export const dynamic = "force-dynamic";

/** Signed params for the browser to upload a background-music file directly to Cloudinary. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: projectId } = await params;
    const project = await getProject(userId, projectId);
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const signed = getSignedUploadParams(`projects/${projectId}/music`);
    return NextResponse.json(signed);
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to prepare upload" }, { status: 500 });
  }
}
