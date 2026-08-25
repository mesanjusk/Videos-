import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { BROWSER_EXECUTION_LOG_LEVELS } from "../constants";

/**
 * Append-only log entries per run — backs the Execution Monitor and the Browser Automation Dashboard.
 *
 * `userId` was added by the merge. This collection was keyed on `runId` alone, and `runId` is a Job
 * id — so a reader who obtained or guessed one could read another user's execution history, which
 * for a browser run means the pages it visited and the steps it took. Nothing called the unscoped
 * reader yet, so there was no live exposure, but it was one wiring-up away. Every other collection
 * in this application filters on `userId`; this one now does too, and
 * `modules/automation/tenancy.test.ts` asserts it structurally so the next model added cannot
 * repeat it.
 */
const browserExecutionLogSchema = new Schema({
  userId: { type: String, required: true, index: true },
  runId: { type: String, required: true, index: true },
  level: { type: String, enum: BROWSER_EXECUTION_LOG_LEVELS, default: "info" },
  message: { type: String, required: true },
  data: { type: Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now, index: true },
});

browserExecutionLogSchema.index({ userId: 1, runId: 1, timestamp: 1 });

export type BrowserExecutionLogDoc = InferSchemaType<typeof browserExecutionLogSchema>;

export const BrowserExecutionLog: Model<BrowserExecutionLogDoc> =
  (models.BrowserExecutionLog as Model<BrowserExecutionLogDoc>) ??
  model<BrowserExecutionLogDoc>("BrowserExecutionLog", browserExecutionLogSchema);
