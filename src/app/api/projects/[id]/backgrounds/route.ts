import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { getProject } from "@/modules/projects/service";
import { createBackground, listBackgrounds } from "@/modules/backgrounds/service";
import { createBackgroundSchema } from "@/modules/backgrounds/schema";
import { enqueueJob } from "@/modules/jobs/service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: projectId } = await params;
    const backgrounds = await listBackgrounds(userId, projectId);
    return NextResponse.json({ backgrounds });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to list backgrounds" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: projectId } = await params;
    const project = await getProject(userId, projectId);
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await request.json();
    const parsed = createBackgroundSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    const style = project.style === "Custom" ? (project.customStyleDescription ?? "Custom") : project.style;
    const background = await createBackground(userId, projectId, style, parsed.data);
    const job = await enqueueJob({
      userId,
      projectId,
      type: "background_image",
      payload: { backgroundId: background._id.toString() },
    });

    return NextResponse.json({ background, job }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to create background" }, { status: 500 });
  }
}
