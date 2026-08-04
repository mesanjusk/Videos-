import { NextResponse } from "next/server";
import { runQueueTick } from "@/core/queue/worker-runtime";

export const dynamic = "force-dynamic";
// Vercel Hobby caps function duration well below this; bump QUEUE_TICK_BUDGET_MS/this together if
// the plan allows more (Pro allows up to 300s). Keep the two in sync — the tick must close its
// workers before the platform kills the function, not after.
export const maxDuration = 60;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * POST: the low-latency path, self-called right after a job is enqueued (modules/jobs/service.ts).
 * GET: Vercel Cron's invocation method — see vercel.json. Both require the same bearer secret;
 * Vercel automatically injects `Authorization: Bearer $CRON_SECRET` for its own cron requests.
 *
 * NOTE (free-tier honesty): Vercel Hobby restricts Cron Jobs to a low daily frequency, not
 * per-minute — so on Hobby, this endpoint's *reliability backstop* only fires occasionally. The
 * fire-and-forget self-call after enqueue remains the primary path and works regardless of plan.
 * For a sub-minute backstop on Hobby, point a free external pinger (e.g. cron-job.org) at this URL
 * instead of relying on vercel.json's schedule.
 */
export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runQueueTick();
  return NextResponse.json(result);
}

export async function GET(request: Request) {
  return POST(request);
}
