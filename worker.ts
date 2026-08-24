/**
 * Standalone, always-on BullMQ worker — the alternative to the Vercel-serverless "poll and drain"
 * tick (`/api/queue/tick`, see ARCHITECTURE.md §7) for anyone self-hosting or running a small
 * always-on process (Railway, Fly.io, a VPS, ...) alongside the Vercel-hosted Next.js app.
 *
 * `processorRegistry` is shared with the Vercel tick route — those processors don't know or care
 * which runtime invoked them. `workerOnlyProcessorRegistry` (Module 4's browser automation) is
 * registered ONLY here, never by the Vercel route — it imports Playwright, which has no business
 * in a serverless function. Useful in particular for `render` jobs too, which can outrun a
 * serverless function's time limit on longer videos; a persistent process has no such ceiling.
 *
 * Browser automation additionally needs Chromium installed on this host specifically (Vercel's
 * build never needs it): run `npx playwright install --with-deps chromium` once during setup.
 *
 * Run with `npm run worker`. Needs the same env vars as the Next.js app (MONGODB_URI, REDIS_URL,
 * CLOUDINARY_*, GEMINI_API_KEY or a connected Google account, ...).
 */
import "dotenv/config";
import { Worker } from "bullmq";
import { getRedisConnection } from "./src/core/queue/connection";
import { processorRegistry } from "./src/core/queue/processors";
import { workerOnlyProcessorRegistry } from "./src/core/queue/worker-only-processors";
import { connectToDatabase } from "./src/core/db/mongoose";
import { registerGoogleFlowProvider } from "./src/core/browser/providers/google-flow/register";

async function main() {
  await connectToDatabase();
  // Module 7B: the only real ProviderAdapter the 7A browser-automation framework ships with —
  // registering it here (not at import time in provider-adapter.ts) keeps browserProviderRegistry
  // itself provider-agnostic; worker.ts is the one process that's supposed to know concrete
  // providers exist, same precedent as workerOnlyProcessorRegistry just below.
  registerGoogleFlowProvider();
  const connection = getRedisConnection();

  const workers = Object.entries({ ...processorRegistry, ...workerOnlyProcessorRegistry }).map(
    ([type, processor]) => new Worker(type, processor, { connection, concurrency: 2 }),
  );

  for (const worker of workers) {
    worker.on("completed", (job) => console.log(`[${worker.name}] completed job ${job.id}`));
    worker.on("failed", (job, err) => console.error(`[${worker.name}] job ${job?.id} failed:`, err.message));
  }

  console.log(`Worker running for queues: ${workers.map((w) => w.name).join(", ")}`);

  const shutdown = async () => {
    console.log("Shutting down workers...");
    await Promise.all(workers.map((w) => w.close()));
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
