import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { BROWSER_TASK_RUN_STATES, BROWSER_TASK_STAGES } from "../constants";

/** One document per browser execution, whether it is owned by the server worker or Chrome extension. */
const browserTaskRunSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project" },
    jobId: { type: Schema.Types.ObjectId, ref: "Job", index: true },
    providerId: { type: String, required: true, index: true },
    taskDefinition: { type: Schema.Types.Mixed, required: true },
    state: { type: String, enum: BROWSER_TASK_RUN_STATES, default: "idle", index: true },
    /** `server` preserves the existing queue/Playwright path; `extension` is claimed by Chrome. */
    executionTarget: { type: String, enum: ["server", "extension"], default: "server", index: true },
    stage: { type: String, enum: BROWSER_TASK_STAGES, default: "pending", index: true },
    claimedBy: { type: String, index: true },
    claimedAt: { type: Date },
    lastHeartbeatAt: { type: Date },
    currentStepIndex: { type: Number, default: 0 },
    totalSteps: { type: Number, default: 0 },
    error: { type: String },
    retryCount: { type: Number, default: 0 },
    downloads: [{ path: { type: String, required: true }, url: { type: String } }],
    resultMetadata: { type: Schema.Types.Mixed },
    screenshots: [{ type: String }],
    startedAt: { type: Date },
    completedAt: { type: Date },
    cancelRequested: { type: Boolean, default: false },
    pauseRequested: { type: Boolean, default: false },
  },
  { timestamps: true },
);

browserTaskRunSchema.index({ userId: 1, updatedAt: -1 });
browserTaskRunSchema.index({ executionTarget: 1, providerId: 1, stage: 1, createdAt: 1 });

export type BrowserTaskRunDoc = InferSchemaType<typeof browserTaskRunSchema>;

export const BrowserTaskRun: Model<BrowserTaskRunDoc> =
  (models.BrowserTaskRun as Model<BrowserTaskRunDoc>) ?? model<BrowserTaskRunDoc>("BrowserTaskRun", browserTaskRunSchema);
