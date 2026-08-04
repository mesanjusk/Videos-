import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { reorderScenesSchema } from "@/modules/scenes/schema";
import { reorderScenes } from "@/modules/scenes/service";

export const dynamic = "force-dynamic";

/** Drag-and-drop reorder from the Scene Manager — body is every scene id in the project, in the new order. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: projectId } = await params;

    const body = await request.json();
    const parsed = reorderScenesSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    const ok = await reorderScenes(userId, projectId, parsed.data.sceneIds);
    if (!ok) return NextResponse.json({ error: "Scene list doesn't match this project" }, { status: 409 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to reorder scenes" }, { status: 500 });
  }
}
