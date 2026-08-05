import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { createStylePackSchema } from "@/modules/style-packs/schema";
import { createStylePack, listStylePacks } from "@/modules/style-packs/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    const stylePacks = await listStylePacks(userId);
    return NextResponse.json({ stylePacks });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to list style packs" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    const parsed = createStylePackSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    const stylePack = await createStylePack(userId, parsed.data);
    return NextResponse.json({ stylePack }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (err instanceof Error && (err as { code?: number }).code === 11000) {
      return NextResponse.json({ error: "You already have a style pack with this name" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create style pack" }, { status: 500 });
  }
}
