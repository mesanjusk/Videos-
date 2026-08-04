import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { createNamedTemplate, listTemplatesForUser } from "@/modules/prompt-templates/service";
import type { PromptScope } from "@/core/prompt-engine/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    const templates = await listTemplatesForUser(userId);
    return NextResponse.json({ templates });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to list prompt templates" }, { status: 500 });
  }
}

const createSchema = z.object({
  scope: z.enum(["story", "character", "background", "scene_image", "scene_video", "voice", "thumbnail", "music"]),
  name: z.string().min(1).max(80),
  template: z.string().min(1).max(8000),
});

/** Saves the current draft text as a new named, reusable preset in a scope (e.g. a second "Hero" character prompt). */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    const result = await createNamedTemplate(userId, parsed.data.scope as PromptScope, parsed.data.name, parsed.data.template);
    if (!result.ok) {
      const status = result.error === "duplicate_name" ? 409 : 404;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json({ template: result.template }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to save preset" }, { status: 500 });
  }
}
