import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { AUTOMATION_TASK_STATUSES, EXECUTION_STEP_STATUSES, TASK_SOURCES } from "../constants";

/**
 * One run of an Automation.
 *
 * Named `AutomationTask`, not Project B's `Task`: this codebase already has a `Job` collection for
 * queue work, and two collections both colloquially called "the task" would be a standing source
 * of confusion. An AutomationTask is the domain record of a workflow run; the `Job` that drives it
 * is queue bookkeeping. `jobId` links them.
 */
const automationTaskSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    automationId: { type: Schema.Types.ObjectId, ref: "Automation", required: true, index: true },
    workflowId: { type: Schema.Types.ObjectId, ref: "Workflow", required: true },
    /** Pinned at enqueue time so editing the workflow never changes an in-flight or past run. */
    workflowVersionId: { type: Schema.Types.ObjectId, ref: "WorkflowVersion", required: true },
    jobId: { type: Schema.Types.ObjectId, ref: "Job", index: true },
    status: { type: String, enum: AUTOMATION_TASK_STATUSES, default: "QUEUED", index: true },
    priority: { type: Number, default: 5 },
    input: { type: Schema.Types.Mixed, default: {} },
    output: { type: Schema.Types.Mixed },
    browserSessionId: { type: Schema.Types.ObjectId, ref: "BrowserSession" },
    workerId: { type: String },
    /** Where the engine paused or failed — the resume point for a WAITING_FOR_HUMAN run. */
    currentStepId: { type: String },
    /**
     * The engine's variable bag as of the last completed step. Secrets are never in here by
     * construction: `{{secret:…}}` tokens resolve straight into the Playwright call and are never
     * written back (core/browser/interpolate.ts).
     */
    variables: { type: Schema.Types.Mixed, default: {} },
    startedAt: { type: Date },
    completedAt: { type: Date },
    durationMs: { type: Number },
    /** A `StructuredError` from core/browser/shared/errors.ts — carries category and retryability. */
    error: { type: Schema.Types.Mixed },
    retryCount: { type: Number, default: 0 },
    callbackUrl: { type: String },
    source: { type: String, enum: TASK_SOURCES, default: "dashboard" },
    /** Set when a production pipeline stage delegated to browser automation (browser fallback). */
    originProjectId: { type: Schema.Types.ObjectId, ref: "Project" },
    originSceneId: { type: Schema.Types.ObjectId, ref: "Scene" },
    cancelRequested: { type: Boolean, default: false },
  },
  { timestamps: true },
);

automationTaskSchema.index({ userId: 1, updatedAt: -1 });
automationTaskSchema.index({ userId: 1, status: 1, createdAt: -1 });

export type AutomationTaskDoc = InferSchemaType<typeof automationTaskSchema>;
export const AutomationTask: Model<AutomationTaskDoc> =
  (models.AutomationTask as Model<AutomationTaskDoc>) ??
  model<AutomationTaskDoc>("AutomationTask", automationTaskSchema);

/** One attempt at running a task — a task retried after a failure has several. */
const executionSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    taskId: { type: Schema.Types.ObjectId, ref: "AutomationTask", required: true, index: true },
    attempt: { type: Number, default: 1 },
    status: { type: String, enum: ["running", "completed", "failed", "paused"], default: "running" },
    startedAt: { type: Date, default: () => new Date() },
    completedAt: { type: Date },
    workerId: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

executionSchema.index({ taskId: 1, createdAt: -1 });

export type ExecutionDoc = InferSchemaType<typeof executionSchema>;
export const Execution: Model<ExecutionDoc> =
  (models.Execution as Model<ExecutionDoc>) ?? model<ExecutionDoc>("Execution", executionSchema);

/**
 * One workflow node, executed. This per-step granularity is what the pre-merge
 * `BrowserExecutionLog` (a flat log line per event) could not give: which selector strategy
 * actually resolved the element, what the step output was, how long it took, and which screenshot
 * belongs to it. `selectorStrategyUsed` in particular is the early-warning signal that a site
 * changed — the run still passes, but on a fallback strategy rather than the intended one.
 */
const executionStepSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    executionId: { type: Schema.Types.ObjectId, ref: "Execution", required: true, index: true },
    taskId: { type: Schema.Types.ObjectId, ref: "AutomationTask", required: true, index: true },
    stepId: { type: String, required: true },
    action: { type: String, required: true },
    name: { type: String },
    selectorStrategyUsed: { type: String },
    status: { type: String, enum: EXECUTION_STEP_STATUSES, default: "PENDING" },
    output: { type: Schema.Types.Mixed },
    error: { type: Schema.Types.Mixed },
    durationMs: { type: Number },
    screenshotFileId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
    timestamp: { type: Date, default: () => new Date() },
  },
  { timestamps: false },
);

executionStepSchema.index({ taskId: 1, timestamp: 1 });

export type ExecutionStepDoc = InferSchemaType<typeof executionStepSchema>;
export const ExecutionStep: Model<ExecutionStepDoc> =
  (models.ExecutionStep as Model<ExecutionStepDoc>) ??
  model<ExecutionStepDoc>("ExecutionStep", executionStepSchema);
