import type { Job as BullJob } from "bullmq";
import { connectToDatabase } from "@/core/db/mongoose";
import { Job, type JobDoc } from "@/modules/jobs/models/Job";
import { markAccountQuotaExceeded } from "@/modules/accounts/selector";
import { ProviderQuotaExceededError } from "@/core/ai/types";
import type { HydratedDocument } from "mongoose";

export type BullJobData = { jobId: string };

/**
 * Shared lifecycle around every processor: loads the Mongo `Job` doc, flips it to `running`, runs
 * the work, and records the outcome. On a `ProviderQuotaExceededError` it marks the pooled Google
 * account exhausted so the *next* attempt (BullMQ's own retry/backoff) picks a different account via
 * `resolveGenerationAccount` — the rotation described in ARCHITECTURE.md §3 happens for free just by
 * retrying, no special-cased retry logic needed here. `Job.status` only flips to `failed` once BullMQ
 * has exhausted its attempts; earlier failures leave it `queued`/`running` so the UI doesn't flash
 * "failed" for a transient error that's about to succeed on retry.
 */
export async function withJobLifecycle(
  bullJob: BullJob<BullJobData>,
  run: (jobDoc: HydratedDocument<JobDoc>) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  await connectToDatabase();
  const jobDoc = await Job.findById(bullJob.data.jobId);
  if (!jobDoc) throw new Error(`Job ${bullJob.data.jobId} not found`);

  jobDoc.status = "running";
  jobDoc.attempts = (jobDoc.attempts ?? 0) + 1;
  await jobDoc.save();

  try {
    const result = await run(jobDoc);
    jobDoc.status = "completed";
    jobDoc.result = result;
    jobDoc.progress = 100;
    await jobDoc.save();
    return result;
  } catch (err) {
    if (err instanceof ProviderQuotaExceededError && jobDoc.googleAccountId) {
      await markAccountQuotaExceeded(jobDoc.googleAccountId.toString());
    }

    const maxAttempts = bullJob.opts.attempts ?? 1;
    const isFinalAttempt = bullJob.attemptsMade + 1 >= maxAttempts;
    if (isFinalAttempt) {
      jobDoc.status = "failed";
      jobDoc.error = err instanceof Error ? err.message : String(err);
      await jobDoc.save();
    }
    throw err; // rethrow so BullMQ's own attempts/backoff bookkeeping still applies
  }
}
