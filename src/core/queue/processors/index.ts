import type { Job as BullJob } from "bullmq";
import type { JobType } from "@/modules/jobs/models/Job";
import type { BullJobData } from "./helpers";
import { processStoryJob } from "./story.processor";
import { processCharacterImageJob } from "./character-image.processor";
import { processBackgroundImageJob } from "./background-image.processor";
import { processSceneImageJob } from "./scene-image.processor";
import { processSceneVideoJob } from "./scene-video.processor";
import { processVoiceJob } from "./voice.processor";
import { processLipSyncJob } from "./lipsync.processor";
import { processRenderJob } from "./render.processor";
import { processThumbnailJob } from "./thumbnail.processor";

/** Every job type is now registered — this is the complete set from ARCHITECTURE.md §7/§11. */
export const processorRegistry: Partial<Record<JobType, (job: BullJob<BullJobData>) => Promise<unknown>>> = {
  story: processStoryJob,
  character_image: processCharacterImageJob,
  background_image: processBackgroundImageJob,
  scene_image: processSceneImageJob,
  scene_video: processSceneVideoJob,
  voice: processVoiceJob,
  lipsync: processLipSyncJob,
  render: processRenderJob,
  thumbnail: processThumbnailJob,
};
