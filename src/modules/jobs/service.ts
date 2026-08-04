import { connectToDatabase } from "@/core/db/mongoose";
import { Job, type JobStatus } from "./models/Job";

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
