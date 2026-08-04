import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const JOB_TYPES = [
  "story",
  "character_image",
  "background_image",
  "scene_image",
  "scene_video",
  "voice",
  "render",
  "thumbnail",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ["queued", "running", "manual_pending", "completed", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

const jobSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    sceneId: { type: Schema.Types.ObjectId, ref: "Scene" },
    characterId: { type: Schema.Types.ObjectId, ref: "Character" },
    type: { type: String, enum: JOB_TYPES, required: true, index: true },
    status: { type: String, enum: JOB_STATUSES, default: "queued", index: true },
    attempts: { type: Number, default: 0 },
    googleAccountId: { type: Schema.Types.ObjectId, ref: "GoogleAccount" },
    payload: { type: Schema.Types.Mixed, required: true },
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
