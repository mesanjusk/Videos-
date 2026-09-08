import { connectToDatabase } from "@/core/db/mongoose";
import { Job } from "@/modules/jobs/models/Job";
import { enqueueJob } from "@/modules/jobs/service";
import { BrowserTaskRun } from "@/modules/browser-automation/models/BrowserTaskRun";

/**
 * Brings a parked image job back once its Google Flow missions are done.
 *
 * `resolveFlowImages` parks a job rather than blocking a serverless function for the minutes a
 * browser mission takes. Something has to wake it, and the only event that knows a mission finished
 * is the extension reporting it — so the wake lives on that path.
 *
 * Called from the status route rather than from `updateExtensionTask` itself, deliberately: the
 * service is imported by the queue processors, and having it enqueue jobs would close an import
 * cycle between the queue and the thing the queue runs. A route is a leaf and can depend on both.
 *
 * Waking is a new job, not a resurrection of the parked one — the same rule the rest of this queue
 * follows. The parked attempt keeps its record of what it was waiting for, and the resumed job
 * finds every mission complete and carries on from there.
 */

interface RunLike {
  _id: unknown;
  userId?: string;
  taskDefinition?: { metadata?: Record<string, unknown> } | null;
}

export async function wakeImageJobForRun(run: RunLike): Promise<string | null> {
  const target = run.taskDefinition?.metadata?.imageTarget as { jobId?: string } | undefined;
  const jobId = target?.jobId;
  if (!jobId) return null;

  await connectToDatabase();
  const job = await Job.findById(jobId).lean();
  // Only a job that actually parked on this. A completed or failed one has moved past it, and a
  // running one is already being served by something else.
  if (!job || job.status !== "manual_pending") return null;

  const flowRunIds = Object.values(((job.payload ?? {}) as { flowRunIds?: Record<string, string> }).flowRunIds ?? {});
  if (flowRunIds.length === 0) return null;

  // Every image the job asked for, not just this one. A character sheet is ten missions; waking on
  // the first would park it again nine times over and enqueue a job per mission for nothing.
  const runs = await BrowserTaskRun.find({ _id: { $in: flowRunIds } }).select("stage").lean();
  const allSettled = flowRunIds.length === runs.length && runs.every((r) => r.stage === "completed" || r.stage === "failed");
  if (!allSettled) return null;

  const resumed = await enqueueJob({
    userId: job.userId,
    projectId: job.projectId ? String(job.projectId) : undefined,
    sceneId: job.sceneId ? String(job.sceneId) : undefined,
    characterId: job.characterId ? String(job.characterId) : undefined,
    type: job.type,
    // Carries flowRunIds forward — that is what makes the resumed job collect results instead of
    // starting a second set of missions.
    payload: { ...((job.payload ?? {}) as Record<string, unknown>), resumedFrom: jobId },
  });

  console.log(`[flow-image] missions for job ${jobId} finished — resumed as ${resumed._id}`);
  return resumed._id.toString();
}
