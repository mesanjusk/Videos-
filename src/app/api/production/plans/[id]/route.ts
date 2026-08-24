import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { getProductionPlan, approveProductionPlan, cancelProductionPlan } from "@/modules/production-plans/service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const plan = await getProductionPlan(userId, id);
    if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ plan });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to load plan" }, { status: 500 });
  }
}

/** Approve — the moment generation actually starts, and the only place it can start from. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    return NextResponse.json(await approveProductionPlan(userId, id));
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to approve plan" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const plan = await cancelProductionPlan(userId, id);
    if (!plan) return NextResponse.json({ error: "Not found or already finished" }, { status: 404 });
    return NextResponse.json({ plan });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to cancel plan" }, { status: 500 });
  }
}
