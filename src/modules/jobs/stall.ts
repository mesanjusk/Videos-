import type { JobStatus, JobType } from "./models/Job";

/**
 * When a job that is supposedly in progress has stopped being in progress.
 *
 * Every "nothing happened" this studio has produced looks the same from the outside: a job sits in
 * a non-terminal status, the page polls it forever, and the spinner never resolves into either a
 * result or an error. The causes differ — a retry stranded past the end of a serverless tick, a
 * worker asleep on a free plan, Redis unreachable — but the user experience is identical, and none
 * of them is distinguishable from "still working" without reading the logs.
 *
 * So the fix is not another cause-specific patch. It is that a job which has not moved in far
 * longer than its kind ever takes is *reported as stuck*, whatever stopped it. That converts an
 * infinite spinner into a sentence the user can act on, and it holds for causes nobody has hit yet.
 *
 * The thresholds are deliberately generous. Being late is not the same as being stuck, and calling
 * a slow render dead is its own kind of wrong — so these sit well beyond how long the work actually
 * takes, and only the truly motionless trip them.
 */

const NON_TERMINAL: JobStatus[] = ["queued", "running", "retrying"];

/** Jobs that drive a browser or push pixels through FFmpeg legitimately run for many minutes. */
const SLOW_JOB_TYPES: JobType[] = ["render", "scene_video", "scene_video_auto", "browser_task", "automation_workflow"];

export const STALL_AFTER_MS = 10 * 60 * 1000;
export const SLOW_STALL_AFTER_MS = 30 * 60 * 1000;

export function stallThresholdFor(type: JobType): number {
  return SLOW_JOB_TYPES.includes(type) ? SLOW_STALL_AFTER_MS : STALL_AFTER_MS;
}

export interface StallCheckInput {
  type: JobType;
  status: JobStatus;
  /** Last time anything wrote to the job — the processor's own status writes keep this current. */
  updatedAt: Date | string;
}

export interface StallReport {
  stalled: boolean;
  /** How long it has been motionless, in ms. Present whether or not it counts as stalled yet. */
  idleMs: number;
}

export function checkStalled(job: StallCheckInput, now: number = Date.now()): StallReport {
  const updatedAt = new Date(job.updatedAt).getTime();
  const idleMs = Number.isNaN(updatedAt) ? 0 : Math.max(0, now - updatedAt);

  if (!NON_TERMINAL.includes(job.status)) return { stalled: false, idleMs };
  return { stalled: idleMs >= stallThresholdFor(job.type), idleMs };
}

/**
 * What to tell someone looking at a stuck job.
 *
 * States the observation, not a guess at the cause — "queued" that never started and "running" that
 * stopped mid-flight fail for different reasons, and naming the wrong one sends people to fix
 * something that was never broken. Where to look next is the same either way.
 */
export function describeStall(job: StallCheckInput, report: StallReport): string | undefined {
  if (!report.stalled) return undefined;
  const minutes = Math.floor(report.idleMs / 60_000);
  const waiting = job.status === "queued" ? "has been waiting to start" : `has been ${job.status}`;

  return (
    `This step ${waiting} for ${minutes} minutes without moving, which is far longer than it should take. ` +
    "Nothing is processing it. Open Queue to see the job and run it again."
  );
}
