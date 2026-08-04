import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { createProject, listProjects } from "@/modules/projects/service";
import { createProjectSchema } from "@/modules/projects/schema";

// Always per-user and DB-backed — never statically rendered/cached.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    const projects = await listProjects(userId);
    return NextResponse.json({ projects });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to list projects" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    const parsed = createProjectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
    }
    const project = await createProject(userId, parsed.data);
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
