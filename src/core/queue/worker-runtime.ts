import { Worker } from "bullmq";
import { getRedisConnection } from "./connection";
import { processorRegistry } from "./processors";

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
  const connection = getRedisConnection();
  const entries = Object.entries(processorRegistry) as Array<
    [string, NonNullable<(typeof processorRegistry)[keyof typeof processorRegistry]>]
  >;

  const workers = entries.map(([type, processor]) => new Worker(type, processor, { connection, autorun: false, concurrency: 2 }));
  const runPromises = workers.map((w) => w.run());

  await sleep(budgetMs);
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all(runPromises);

  return { types: entries.map(([type]) => type) };
}
