import { getRedisConnection } from "./connection";

/**
 * Whether a standalone worker process is actually running right now.
 *
 * Three job types — `scene_video_auto`, `browser_task`, `automation_workflow` — are registered only
 * in `worker-only-processors.ts`, because they reach Playwright and nothing reachable from a Vercel
 * function may. The comment there calls a deployment with no worker "an honest degrade": the job
 * stays queued and visible until a worker exists.
 *
 * It is not honest if the code that enqueues it never checks. A `scene_video` job that diverts to
 * `scene_video_auto` reports itself *completed*, so a deployment with no worker shows a project
 * that is making a video, forever, with nothing failed and nothing to press. Confirmed live: this
 * repo's `render.yaml` describes a worker that was never deployed, and every video diverted into a
 * queue nothing was draining.
 *
 * So presence is a fact to be checked, not assumed. The worker refreshes a key that expires on its
 * own; anything that would hand work to a worker asks first, and takes the route that still works
 * when the answer is no.
 */

const HEARTBEAT_KEY = "worker:heartbeat";

/** Refresh interval. Comfortably inside the TTL so an ordinary hiccup does not read as death. */
export const HEARTBEAT_INTERVAL_MS = 30_000;
/** How long a heartbeat stays valid. Expiry *is* the death notice — no cleanup to forget to run. */
export const HEARTBEAT_TTL_SECONDS = 90;

export interface WorkerPresence {
  alive: boolean;
  workerId?: string;
  queues?: string[];
  lastSeenAt?: string;
}

async function beat(workerId: string, queues: string[]): Promise<void> {
  const payload = JSON.stringify({ workerId, queues, lastSeenAt: new Date().toISOString() });
  await getRedisConnection().set(HEARTBEAT_KEY, payload, "EX", HEARTBEAT_TTL_SECONDS);
}

/**
 * Starts announcing this process. Called by worker.ts; returns the timer so shutdown can clear it.
 *
 * Failures are logged, never thrown: a worker that cannot reach Redis has bigger problems than its
 * heartbeat, and crashing the process over a missed announcement would turn a blip into an outage.
 */
export function startWorkerHeartbeat(workerId: string, queues: string[]): NodeJS.Timeout {
  const announce = () => {
    beat(workerId, queues).catch((err) => console.error(`[worker ${workerId}] heartbeat failed:`, err));
  };
  announce();
  const timer = setInterval(announce, HEARTBEAT_INTERVAL_MS);
  // Nothing should stay alive purely to keep announcing itself.
  timer.unref?.();
  return timer;
}

/** Removes the heartbeat on a clean shutdown, so "gone" is known immediately rather than in 90s. */
export async function stopWorkerHeartbeat(): Promise<void> {
  await getRedisConnection().del(HEARTBEAT_KEY);
}

/** Reads the heartbeat. Never throws — an unreachable Redis reports "no worker", which is the safe answer. */
export async function getWorkerPresence(): Promise<WorkerPresence> {
  try {
    const raw = await getRedisConnection().get(HEARTBEAT_KEY);
    if (!raw) return { alive: false };
    const parsed = JSON.parse(raw) as Omit<WorkerPresence, "alive">;
    return { alive: true, ...parsed };
  } catch {
    return { alive: false };
  }
}

export async function isWorkerRunning(): Promise<boolean> {
  return (await getWorkerPresence()).alive;
}
