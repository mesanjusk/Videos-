import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { createVoicePackSchema } from "@/modules/voice-packs/schema";
import { createVoicePack, listVoicePacks } from "@/modules/voice-packs/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    const voicePacks = await listVoicePacks(userId);
    return NextResponse.json({ voicePacks });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to list voice packs" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    const parsed = createVoicePackSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    const voicePack = await createVoicePack(userId, parsed.data);
    return NextResponse.json({ voicePack }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (err instanceof Error && (err as { code?: number }).code === 11000) {
      return NextResponse.json({ error: "You already have a voice pack with this name" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create voice pack" }, { status: 500 });
  }
}
