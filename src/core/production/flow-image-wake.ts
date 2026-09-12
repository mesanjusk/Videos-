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
  await connectToDatabase();
  const runId = String(run._id);

  // Whichever job is parked on this mission *now* — not necessarily the one that started it.
  //
  // The mission records the job id that created it, and that used to be the only way back. But a
  // park that outlasts the stall threshold gets a "Try again", and running a stalled job again
  // marks the original cancelled and continues as a new job carrying the same mission ids. The
  // recorded id then points at a cancelled job, this returned null, and when the missions finally
  // finished nothing woke the job that was still waiting for them — the one failure mode a retry
  // was supposed to fix. So the lookup follows the missions rather than the id, and falls back to
  // the recorded id for jobs parked before this list existed.
  const target = run.taskDefinition?.metadata?.imageTarget as { jobId?: string } | undefined;
  const job =
    (await Job.findOne({ "payload.flowRunIdList": runId, status: "manual_pending" }).sort({ createdAt: -1 }).lean()) ??
    (target?.jobId ? await Job.findById(target.jobId).lean() : null);

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

  const jobId = job._id.toString();
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

/**
 * Wakes whatever is parked on each of these runs, best-effort.
 *
 * Used by the sweeps that fail missions an extension abandoned: marking the run failed is only half
 * the repair — the job parked on it has to be told, or it waits out its own stall threshold and
 * offers a retry that inherits the same dead missions. One failure does not stop the rest.
 */
export async function wakeImageJobsForRuns(runs: RunLike[]): Promise<number> {
  let woken = 0;
  for (const run of runs) {
    const resumed = await wakeImageJobForRun(run).catch((err) => {
      console.error(`[flow-image] could not wake the job parked on run ${String(run._id)}:`, err);
      return null;
    });
    if (resumed) woken += 1;
  }
  return woken;
}
