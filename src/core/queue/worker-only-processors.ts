import type { Job as BullJob } from "bullmq";
import type { JobType } from "@/modules/jobs/models/Job";
import type { BullJobData } from "./processors/helpers";
import { processSceneVideoAutoJob } from "./processors/scene-video-auto.processor";
import { processBrowserTaskJob } from "./processors/browser-task.processor";

/**
 * Job types that must NEVER be registered in core/queue/processors/index.ts (the shared registry
 * both worker.ts and the Vercel-serverless `/api/queue/tick` route consume). Everything here
 * transitively imports Playwright — see core/automation/ and
 * core/ai/providers/google/google-flow-automated.ts — which has no business inside a Vercel
 * serverless function (no guaranteed browser binary, unsuited execution time limits, bundle size).
 *
 * ONLY worker.ts imports this file. If a job of one of these types is enqueued while no standalone
 * worker process is running, it simply stays "queued" — visible on the /queue dashboard (Module 3)
 * — until one is, or the operator falls back to the manual hand-off. That's an honest degrade, not
 * a silent failure.
 */
export const workerOnlyProcessorRegistry: Partial<Record<JobType, (job: BullJob<BullJobData>) => Promise<unknown>>> = {
  scene_video_auto: processSceneVideoAutoJob,
  browser_task: processBrowserTaskJob,
};
