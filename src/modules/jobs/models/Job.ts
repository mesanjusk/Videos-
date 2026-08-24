import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const JOB_TYPES = [
  "story",
  "character_image",
  "background_image",
  "scene_image",
  "scene_video",
  // Browser-automation-backed video generation — a distinct job type/queue from scene_video
  // specifically so its processor (which imports Playwright) can be registered only in worker.ts's
  // worker-only registry, never the shared one the Vercel serverless tick route uses.
  // See core/queue/worker-only-processors.ts.
  "scene_video_auto",
  "voice",
  "lipsync",
  "render",
  "thumbnail",
  // Generic browser-automation execution (Module 7A) — like scene_video_auto, imports Playwright
  // transitively (via core/browser/) and is registered only in worker-only-processors.ts.
  // Unlike every other job type, it's not always scene/project-bound (see projectId below).
  "browser_task",
  // Instagram auto-reply (ARCHITECTURE.md §18) — a fast API-only job (Gemini + Meta Graph API, no
  // Playwright), registered in the shared processorRegistry like voice/thumbnail. Not scene/project
  // -bound; see projectId below.
  "instagram_reply",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["queued", "running", "retrying", "manual_pending", "completed", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

const jobSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    // Not `required` since Module 7A: a `browser_task` job is often a standalone browser-automation
    // run with no owning Project/Scene. Every other job type still always supplies one.
    projectId: { type: Schema.Types.ObjectId, ref: "Project", index: true },
    sceneId: { type: Schema.Types.ObjectId, ref: "Scene" },
    characterId: { type: Schema.Types.ObjectId, ref: "Character" },
    type: { type: String, enum: JOB_TYPES, required: true, index: true },
    status: { type: String, enum: JOB_STATUSES, default: "queued", index: true },
    attempts: { type: Number, default: 0 },
    googleAccountId: { type: Schema.Types.ObjectId, ref: "GoogleAccount" },
    // Not `required` — most job types enqueue with `payload: {}`, and Mongoose's default
    // `minimize` behavior strips empty objects before writing to MongoDB, so a `required: true`
    // here made every one of those jobs fail Mongoose's re-validation the moment the queue worker
    // re-loaded and re-saved the document (to mark it "running") — before the job's real work ever
    // ran. Confirmed live: "Job validation failed: payload: Path `payload` is required."
    payload: { type: Schema.Types.Mixed },
    result: { type: Schema.Types.Mixed },
    error: { type: String },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    logs: [{ type: String }],
    bullJobId: { type: String, index: true }, // correlates to the BullMQ job id in Redis
  },
  { timestamps: true },
);

jobSchema.index({ userId: 1, status: 1, createdAt: -1 });

export type JobDoc = InferSchemaType<typeof jobSchema>;

export const Job: Model<JobDoc> = (models.Job as Model<JobDoc>) ?? model<JobDoc>("Job", jobSchema);
