import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { getOrCreateSettings, setDefaultLanguage, setProviderOverride } from "@/modules/settings/service";

export const dynamic = "force-dynamic";

const patchSchema = z.union([
  z.object({ capability: z.enum(["story", "image", "video", "voice", "lipsync"]), providerId: z.string().min(1) }),
  z.object({ defaultLanguage: z.string().min(2).max(10) }),
]);

export async function GET() {
  try {
    const userId = await requireUserId();
    const settings = await getOrCreateSettings(userId);
    return NextResponse.json({ settings });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    const settings =
      "capability" in parsed.data
        ? await setProviderOverride(userId, parsed.data.capability, parsed.data.providerId)
        : await setDefaultLanguage(userId, parsed.data.defaultLanguage);

    return NextResponse.json({ settings });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
