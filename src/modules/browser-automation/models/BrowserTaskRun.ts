import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { BROWSER_TASK_RUN_STATES } from "../constants";

/**
 * One document per TaskEngine execution. `taskDefinition` stores the serializable `BrowserTask`
 * verbatim (core/browser/types.ts's `BrowserTask` is plain JSON by design) so a run can
 * be reloaded and resumed via `TaskEngine.resume(runId)` after a process restart — this collection
 * is exactly what a `TaskStore` + `StateStore` implementation reads/writes.
 */
const browserTaskRunSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project" }, // optional — most browser tasks aren't scene/project-bound (see docs/BROWSER-AUTOMATION-FRAMEWORK-PLAN.md §2)
    jobId: { type: Schema.Types.ObjectId, ref: "Job", index: true }, // the Scene Queue Job this run is driven by, if any
    providerId: { type: String, required: true, index: true },
    taskDefinition: { type: Schema.Types.Mixed, required: true },
    state: { type: String, enum: BROWSER_TASK_RUN_STATES, default: "idle", index: true },
    currentStepIndex: { type: Number, default: 0 },
    totalSteps: { type: Number, default: 0 },
    error: { type: String },
    retryCount: { type: Number, default: 0 },
    downloads: [{ path: { type: String, required: true }, url: { type: String } }],
    screenshots: [{ type: String }],
    startedAt: { type: Date },
    completedAt: { type: Date },
    // Cooperative cross-process signals: the API (Vercel) can never call a worker process's
    // in-memory TaskEngine.pause()/cancel() directly, so it sets a flag here instead; the
    // browser_task processor polls it and forwards to the TaskEngine it actually owns.
    cancelRequested: { type: Boolean, default: false },
    pauseRequested: { type: Boolean, default: false },
  },
  { timestamps: true },
);

browserTaskRunSchema.index({ userId: 1, updatedAt: -1 });

export type BrowserTaskRunDoc = InferSchemaType<typeof browserTaskRunSchema>;

export const BrowserTaskRun: Model<BrowserTaskRunDoc> =
  (models.BrowserTaskRun as Model<BrowserTaskRunDoc>) ?? model<BrowserTaskRunDoc>("BrowserTaskRun", browserTaskRunSchema);
