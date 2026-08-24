/**
 * The always-on worker process — the alternative to the Vercel-serverless "poll and drain" tick
 * (`/api/queue/tick`, see ARCHITECTURE.md §7) for anyone self-hosting or running a small persistent
 * process (Render, Railway, Fly.io, a VPS, ...) alongside the Vercel-hosted Next.js app.
 *
 * `processorRegistry` is shared with the Vercel tick route — those processors don't know or care
 * which runtime invoked them. `workerOnlyProcessorRegistry` is registered ONLY here, never by the
 * Vercel route: everything in it reaches Playwright, which has no business in a serverless
 * function. Useful in particular for `render` jobs too, which can outrun a serverless function's
 * time limit on longer videos; a persistent process has no such ceiling.
 *
 * Playwright-backed jobs additionally need Chromium installed on this host specifically (Vercel's
 * build never needs it): run `npx playwright install --with-deps chromium` once during setup.
 *
 * ## What the merge added
 *
 * Three things from Browser Automation OS's worker, none of which this one had:
 *
 *  - a **health endpoint**, so a PaaS health check and the dashboard's "worker status" card have
 *    something to poll. Bound to `PORT` first, because Render and most hosts inject it and expect
 *    the service to listen on it. Implemented with `node:http` rather than pulling in Express for
 *    one route.
 *  - the **schedule sweeper**, which must run here and nowhere else — inside the serverless tick it
 *    would fire on every warm invocation. See core/automation/scheduler.ts.
 *  - **graceful shutdown** that actually waits for in-flight jobs and closes Redis, instead of
 *    calling process.exit while a browser run is mid-step.
 *
 * Run with `npm run worker`. Needs the same env vars as the Next.js app (MONGODB_URI, REDIS_URL,
 * CLOUDINARY_* or STORAGE_PROVIDER=local, GEMINI_API_KEY or a connected Google account, ...).
 */
import "dotenv/config";
import { createServer } from "node:http";
import { Worker } from "bullmq";
import { getRedisConnection, closeRedisConnection } from "./src/core/queue/connection";
import { processorRegistry } from "./src/core/queue/processors";
import { workerOnlyProcessorRegistry } from "./src/core/queue/worker-only-processors";
import { connectToDatabase } from "./src/core/db/mongoose";
import { registerGoogleFlowProvider } from "./src/core/browser/providers/google-flow/register";
import { startScheduler } from "./src/core/automation/scheduler";

const WORKER_ID = process.env.WORKER_ID ?? `worker-${process.pid}`;
const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 2);
const HEALTH_PORT = Number(process.env.PORT ?? process.env.WORKER_PORT ?? 4000);

async function main() {
  await connectToDatabase();

  // The only real ProviderAdapter the browser engine ships with. Registering it here (rather than
  // at import time in provider-adapter.ts) keeps browserProviderRegistry itself provider-agnostic;
  // worker.ts is the one process that is supposed to know concrete providers exist, the same
  // precedent workerOnlyProcessorRegistry sets just below.
  registerGoogleFlowProvider();

  const connection = getRedisConnection();
  const registry = { ...processorRegistry, ...workerOnlyProcessorRegistry };

  const workers = Object.entries(registry).map(
    ([type, processor]) => new Worker(type, processor, { connection, concurrency: CONCURRENCY }),
  );

  for (const worker of workers) {
    worker.on("completed", (job) => console.log(`[${worker.name}] completed job ${job.id}`));
    worker.on("failed", (job, err) => console.error(`[${worker.name}] job ${job?.id} failed:`, err.message));
  }

  const startedAt = new Date();
  const health = createServer((req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        workerId: WORKER_ID,
        startedAt: startedAt.toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        queues: workers.map((w) => w.name),
        concurrency: CONCURRENCY,
      }),
    );
  });
  health.listen(HEALTH_PORT, () => console.log(`[worker ${WORKER_ID}] health endpoint on :${HEALTH_PORT}/health`));

  const schedulerTimer = startScheduler();

  console.log(`[worker ${WORKER_ID}] running for queues: ${workers.map((w) => w.name).join(", ")}`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[worker ${WORKER_ID}] ${signal} received — finishing in-flight jobs...`);
    clearInterval(schedulerTimer);
    health.close();
    // `close()` without force lets a job that is mid-step finish rather than abandoning a browser
    // session halfway through a form.
    await Promise.allSettled(workers.map((w) => w.close()));
    await closeRedisConnection().catch(() => {});
    console.log(`[worker ${WORKER_ID}] shutdown complete`);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
