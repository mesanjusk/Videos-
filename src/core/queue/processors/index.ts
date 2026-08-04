import type { Job as BullJob } from "bullmq";
import type { JobType } from "@/modules/jobs/models/Job";
import type { BullJobData } from "./helpers";
import { processStoryJob } from "./story.processor";
import { processCharacterImageJob } from "./character-image.processor";
import { processBackgroundImageJob } from "./background-image.processor";
import { processSceneImageJob } from "./scene-image.processor";
import { processSceneVideoJob } from "./scene-video.processor";

/**
 * Only job types with an entry here get a Worker spun up by the queue tick (core/queue/worker-runtime.ts).
 * Add voice/render/thumbnail entries as their stages land — nothing else in the queue system needs
 * to change.
 */
export const processorRegistry: Partial<Record<JobType, (job: BullJob<BullJobData>) => Promise<unknown>>> = {
  story: processStoryJob,
  character_image: processCharacterImageJob,
  background_image: processBackgroundImageJob,
  scene_image: processSceneImageJob,
  scene_video: processSceneVideoJob,
};
