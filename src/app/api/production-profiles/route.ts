import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { createProductionProfileSchema } from "@/modules/production-profiles/schema";
import { createProductionProfile, listProductionProfiles } from "@/modules/production-profiles/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireUserId();
    const profiles = await listProductionProfiles(userId);
    return NextResponse.json({ profiles });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to list production profiles" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    const parsed = createProductionProfileSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    const profile = await createProductionProfile(userId, parsed.data);
    return NextResponse.json({ profile }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (err instanceof Error && (err as { code?: number }).code === 11000) {
      return NextResponse.json({ error: "You already have a production profile with this name" }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create production profile" }, { status: 500 });
  }
}
