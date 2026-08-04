import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { cloneBackgroundSchema } from "@/modules/backgrounds/schema";
import { cloneBackgroundIntoProject } from "@/modules/backgrounds/service";
import { getProject } from "@/modules/projects/service";

export const dynamic = "force-dynamic";

/** Copies a background (already-generated image, style, lighting) into another project the user owns. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: backgroundId } = await params;

    const body = await request.json();
    const parsed = cloneBackgroundSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    const targetProject = await getProject(userId, parsed.data.targetProjectId);
    if (!targetProject) return NextResponse.json({ error: "Target project not found" }, { status: 404 });

    const result = await cloneBackgroundIntoProject(userId, backgroundId, parsed.data.targetProjectId);
    if (!result.ok) {
      if (result.error === "not_found") return NextResponse.json({ error: "Background not found" }, { status: 404 });
      return NextResponse.json({ error: "That project already has a background with this name" }, { status: 409 });
    }

    return NextResponse.json({ background: result.background }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to add background to project" }, { status: 500 });
  }
}
