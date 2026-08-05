import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { generateFromProfileSchema } from "@/modules/production-profiles/schema";
import { generateFromProfile } from "@/core/production-engine/generate";

export const dynamic = "force-dynamic";
// enqueueJob() (inside generateFromProfile) runs a queue tick in-process via after() before this
// function is allowed to freeze — same budget as /api/queue/tick.
export const maxDuration = 60;

/** The Production Engine's single entry point: topic + optional notes in, a fully-configured
 * project (characters assigned, style/prompt presets applied, story generation already enqueued)
 * out. See core/production-engine/generate.ts. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id: profileId } = await params;

    const body = await request.json();
    const parsed = generateFromProfileSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    const result = await generateFromProfile(userId, profileId, parsed.data.topic, parsed.data.notes);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (err instanceof Error && err.message === "Production profile not found") {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: "Failed to generate from this profile" }, { status: 500 });
  }
}
