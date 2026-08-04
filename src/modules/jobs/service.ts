import { connectToDatabase } from "@/core/db/mongoose";
import { Job, type JobStatus, type JobType } from "./models/Job";
import { getQueue } from "@/core/queue/queues";

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
 * matching BullMQ job (the actual work queue). Fires a best-effort, non-blocking self-call to
 * /api/queue/tick so the job usually starts within a second or two rather than waiting for the
 * next cron tick (ARCHITECTURE.md §7) — failures there are silently ignored, the cron is the backstop.
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

  triggerQueueTick();
  return jobDoc;
}

function triggerQueueTick(): void {
  const base = process.env.NEXTAUTH_URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) return;
  fetch(new URL("/api/queue/tick", base), {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  }).catch(() => {
    // best-effort only — the Vercel Cron backstop will pick this job up regardless
  });
}

export async function getJob(userId: string, jobId: string) {
  await connectToDatabase();
  return Job.findOne({ _id: jobId, userId }).lean();
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
