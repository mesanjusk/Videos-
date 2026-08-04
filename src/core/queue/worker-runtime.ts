import { Worker } from "bullmq";
import { getRedisConnection } from "./connection";
import { processorRegistry } from "./processors";
import { getQueue } from "./queues";
import { reactivateExpiredQuotas } from "@/modules/accounts/selector";
import type { JobType } from "@/modules/jobs/models/Job";

const DEFAULT_BUDGET_MS = Number(process.env.QUEUE_TICK_BUDGET_MS ?? 45_000);

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

  const workers = entries.map(([type, processor]) => {
    const worker = new Worker(type, processor, { connection, autorun: false, concurrency: 2 });
    worker.on("completed", (job) => console.log(`[queue] ${type} job ${job.id} (mongo ${job.data.jobId}) completed`));
    worker.on("failed", (job, err) =>
      console.error(`[queue] ${type} job ${job?.id} (mongo ${job?.data.jobId}) failed:`, err),
    );
    return worker;
  });
  const runPromises = workers.map((w) => w.run());

  await sleep(budgetMs);
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all(runPromises);

  return { types: entries.map(([type]) => type) };
}
