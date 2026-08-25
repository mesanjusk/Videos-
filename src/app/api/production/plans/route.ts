import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { listProductionPlans, requestProductionPlan, listAvailablePipelines } from "@/modules/production-plans/service";
import { PRODUCTION_STAGES } from "@/core/production/types";
import { COST_POLICIES } from "@/core/cost";
import { checkRateLimit } from "@/core/security/rate-limit";

export const dynamic = "force-dynamic";

const createPlanSchema = z.object({
  request: z.string().min(8, "Describe the video in a sentence or so.").max(2000),
  pipelineId: z.string().optional(),
  language: z.string().max(20).optional(),
  durationSeconds: z.number().int().min(5).max(3600).optional(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:5"]).optional(),
  costPolicy: z.enum(COST_POLICIES).optional(),
  skipStages: z.array(z.enum(PRODUCTION_STAGES)).optional(),
});

export async function GET() {
  try {
    const userId = await requireUserId();
    const [plans, pipelines] = await Promise.all([listProductionPlans(userId), Promise.resolve(listAvailablePipelines())]);
    return NextResponse.json({ plans, pipelines });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to list production plans" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();

    // Planning costs a model call every time. Rate limiting it is the difference between a
    // mistyped loop in someone's script being an annoyance and being a bill.
    const limit = checkRateLimit(`production-plan:${userId}`, 20, 60_000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many planning requests — try again in a minute." },
        { status: 429, headers: { "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } },
      );
    }

    const parsed = createPlanSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });
    }

    const result = await requestProductionPlan(userId, parsed.data);
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // A cost-policy refusal is the user's answer, not a server fault — say what happened.
    if (err instanceof Error && /ZERO_COST/.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to start planning" }, { status: 500 });
  }
}
