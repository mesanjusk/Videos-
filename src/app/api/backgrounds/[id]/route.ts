import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { deleteBackground, getBackground } from "@/modules/backgrounds/service";
import { enqueueJob } from "@/modules/jobs/service";

export const dynamic = "force-dynamic";

/** Regenerate — same background metadata, a fresh image. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const background = await getBackground(userId, id);
    if (!background) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const job = await enqueueJob({
      userId,
      projectId: background.projectId.toString(),
      type: "background_image",
      payload: { backgroundId: id },
    });
    return NextResponse.json({ job }, { status: 202 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to start generation" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    await deleteBackground(userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to delete background" }, { status: 500 });
  }
}
