import { after } from "next/server";
import { connectToDatabase } from "@/core/db/mongoose";
import { Job, type JobStatus, type JobType } from "./models/Job";
import { getQueue } from "@/core/queue/queues";
import { runQueueTick } from "@/core/queue/worker-runtime";

export interface EnqueueJobInput {
  userId: string;
  projectId: string;
  sceneId?: string;
  characterId?: string;
  type: JobType;
  payload: Record<string, unknown>;
}

/**
 * Creates the Mongo `Job` record (source of truth for status/progress the UI polls) and adds the
 * matching BullMQ job (the actual work queue). Runs a queue tick in-process via `after()` once the
 * response has been sent, so the job usually starts within a second or two rather than waiting for
 * the next cron tick (ARCHITECTURE.md §7). This used to be a fire-and-forget self-HTTP-call to
 * /api/queue/tick, but that made "start processing now" depend on NEXTAUTH_URL and CRON_SECRET
 * matching exactly in every environment — a single 401 there (confirmed live) left jobs stuck queued
 * for up to a day, since Vercel Hobby only allows a once-daily cron backstop. Calling runQueueTick()
 * directly removes the network round-trip and the auth dependency entirely. The Vercel Cron backstop
 * still hits /api/queue/tick over HTTP (it has to — cron calls a URL), unaffected by this change.
 */
export async function enqueueJob(input: EnqueueJobInput) {
  await connectToDatabase();
  const jobDoc = await Job.create({
    userId: input.userId,
    projectId: input.projectId,
    sceneId: input.sceneId,
    characterId: input.characterId,
    type: input.type,
    status: "queued",
    payload: input.payload,
  });

  const queue = getQueue(input.type);
  const bullJob = await queue.add(input.type, { jobId: jobDoc._id.toString() });
  jobDoc.bullJobId = bullJob.id;
  await jobDoc.save();

  after(() => {
    console.log(`[queue] in-process tick starting after enqueueing ${input.type} job ${jobDoc._id}`);
    return runQueueTick()
      .then((result) => {
        console.log(`[queue] in-process tick finished, ran worker types: ${result.types.join(", ")}`);
      })
      .catch((err) => {
        // Logged, not rethrown — the Vercel Cron backstop will pick this job up regardless.
        console.error("[queue] in-process tick failed:", err);
      });
  });
  return jobDoc;
}

export async function getJob(userId: string, jobId: string) {
  await connectToDatabase();
  return Job.findOne({ _id: jobId, userId }).lean();
}

/**
 * Cancels a job that's still waiting to be picked up. Only "queued" jobs are eligible — once a
 * processor has flipped a job to "running" it's actively mid-work, and cancelling that safely
 * would need cooperative cancellation inside every processor, not implemented here. Removes the
 * BullMQ job too so it can't be dequeued later (e.g. by cron) after Mongo already calls it cancelled;
 * if that removal fails (e.g. a race where BullMQ had just picked it up), the Mongo side still moves
 * to "cancelled" — worst case the processor's own status write on completion "wins" back over it.
 */
export async function cancelJob(userId: string, jobId: string) {
  await connectToDatabase();
  const jobDoc = await Job.findOne({ _id: jobId, userId });
  if (!jobDoc) return null;
  if (jobDoc.status !== "queued") {
    throw new Error("Only jobs still waiting in the queue can be cancelled.");
  }

  if (jobDoc.bullJobId) {
    const queue = getQueue(jobDoc.type);
    const bullJob = await queue.getJob(jobDoc.bullJobId);
    await bullJob?.remove().catch(() => {
      // best-effort — Mongo status below is the source of truth the UI reads
    });
  }

  jobDoc.status = "cancelled";
  await jobDoc.save();
  return jobDoc;
}

export async function listRecentJobs(userId: string, limit = 10) {
  await connectToDatabase();
  return Job.find({ userId }).sort({ createdAt: -1 }).limit(limit).populate("projectId", "title").lean();
}

export async function countJobsByStatus(userId: string): Promise<Record<JobStatus, number>> {
  await connectToDatabase();
  const rows = await Job.aggregate<{ _id: JobStatus; count: number }>([
    { $match: { userId } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const base: Record<JobStatus, number> = { queued: 0, running: 0, manual_pending: 0, completed: 0, failed: 0, cancelled: 0 };
  for (const row of rows) base[row._id] = row.count;
  return base;
}
