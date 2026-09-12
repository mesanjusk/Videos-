import { Worker } from "bullmq";
import { getRedisConnection } from "./connection";
import { processorRegistry } from "./processors";
import { getQueue } from "./queues";
import { reactivateExpiredQuotas } from "@/modules/accounts/selector";
import { failStaleExtensionTasks } from "@/modules/browser-automation/extension-service";
import { wakeImageJobsForRuns } from "@/core/production/flow-image-wake";
import type { JobType } from "@/modules/jobs/models/Job";

const DEFAULT_BUDGET_MS = Number(process.env.QUEUE_TICK_BUDGET_MS ?? 45_000);
/** How often the tick asks whether there is still anything to do. */
const DRAIN_POLL_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The Vercel-serverless adaptation of a BullMQ Worker (ARCHITECTURE.md §7): spins up one Worker per
 * registered job type with `autorun: false`, runs them for a bounded time budget, then closes them —
 * "poll and drain" instead of a persistent process. Invoked by POST /api/queue/tick, which is hit
 * both by Vercel Cron (the reliability backstop) and by a fire-and-forget self-call right after a
 * job is enqueued (for low latency).
 */
export async function runQueueTick(budgetMs: number = DEFAULT_BUDGET_MS): Promise<{ types: string[] }> {
  // Was defined but never called anywhere (confirmed live: a quota_exceeded account had no path
  // back to "active" short of manually clicking Reactivate now in the Accounts UI) — every tick is
  // a reasonable place to sweep for accounts whose 24h quota.resetsAt has passed.
  await reactivateExpiredQuotas().catch((err) => console.error("[queue] reactivateExpiredQuotas failed:", err));

  // Missions whose extension stopped reporting, and the jobs parked on them.
  //
  // Swept here rather than only in the worker's scheduler, because the Chrome-extension path needs
  // no worker at all: a deployment that generates images through Flow and nothing else may have no
  // persistent process anywhere, and an abandoned mission there would strand its job forever. Safe
  // on every invocation for the same reason `reactivateExpiredQuotas` above is — it is a time-
  // filtered update, so running it often changes nothing except how quickly a dead run is noticed.
  await sweepAbandonedMissions().catch((err) => console.error("[queue] mission sweep failed:", err));

  const connection = getRedisConnection();
  const entries = Object.entries(processorRegistry) as Array<
    [string, NonNullable<(typeof processorRegistry)[keyof typeof processorRegistry]>]
  >;

  const backlog = await Promise.all(
    entries.map(async ([type]) => {
      const counts = await getQueue(type as JobType).getJobCounts("wait", "active", "delayed", "failed");
      return `${type}:${JSON.stringify(counts)}`;
    }),
  );
  console.log(`[queue] backlog at tick start — ${backlog.join(" ")}`);

  /** Jobs this tick can still reach: waiting, running, or waiting out a retry backoff. */
  const pendingWork = async (): Promise<number> => {
    const counts = await Promise.all(
      entries.map(([type]) => getQueue(type as JobType).getJobCounts("wait", "active", "delayed")),
    );
    return counts.reduce((sum, c) => sum + (c.wait ?? 0) + (c.active ?? 0) + (c.delayed ?? 0), 0);
  };

  const workers = entries.map(([type, processor]) => {
    const worker = new Worker(type, processor, { connection, autorun: false, concurrency: 2 });
    worker.on("completed", (job) => console.log(`[queue] ${type} job ${job.id} (mongo ${job.data.jobId}) completed`));
    worker.on("failed", (job, err) =>
      console.error(`[queue] ${type} job ${job?.id} (mongo ${job?.data.jobId}) failed:`, err),
    );
    return worker;
  });
  const runPromises = workers.map((w) => w.run());

  // Run until the queues are empty rather than for a flat budget.
  //
  // A failed job is retried on a backoff, so between attempts it is *delayed* — not waiting, not
  // active. Closing the workers on a fixed timer while one sits there strands it: the Mongo job
  // stays "retrying", the UI polls a status that will never change, and nothing runs the attempt
  // until the next enqueue or the daily cron. That is what "nothing happened" looks like from the
  // outside, and it happened live to a plan job whose second attempt failed near the end of the
  // budget. Counting delayed jobs as work keeps the tick open for its own retries.
  //
  // The other half is leaving early: a tick that finishes its queue in two seconds now returns in
  // two seconds instead of idling out the remaining budget.
  const deadline = Date.now() + budgetMs;
  let remaining = 0;
  while (Date.now() < deadline) {
    await sleep(Math.min(DRAIN_POLL_MS, deadline - Date.now()));
    remaining = await pendingWork().catch(() => 1);
    if (remaining === 0) break;
  }

  if (remaining > 0) {
    // Not silent: a job left here waits for the next tick, which on a daily cron is a long way off.
    console.warn(
      `[queue] tick budget (${budgetMs}ms) ended with ${remaining} job(s) still waiting, running or backing off — ` +
        "they will not move until the next tick.",
    );
  }

  await Promise.all(workers.map((w) => w.close()));
  await Promise.all(runPromises);

  return { types: entries.map(([type]) => type) };
}

/** How long an extension may go silent mid-mission before the mission is called dead. */
export const MISSION_HEARTBEAT_GRACE_MS = 10 * 60 * 1000;

/**
 * Fails missions an extension abandoned and wakes whatever was waiting on them.
 *
 * Shared by the serverless tick above and the worker's scheduler, so it runs wherever this
 * application happens to be running. Marking the run failed is only half of it: the parked job has
 * to be woken, or it sits until its own stall threshold and then offers a retry that inherits the
 * same dead missions.
 */
export async function sweepAbandonedMissions(): Promise<{ failed: number; woken: number }> {
  const stale = await failStaleExtensionTasks(new Date(Date.now() - MISSION_HEARTBEAT_GRACE_MS));
  if (stale.length === 0) return { failed: 0, woken: 0 };
  const woken = await wakeImageJobsForRuns(stale);
  return { failed: stale.length, woken };
}
