import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { BROWSER_EXECUTION_LOG_LEVELS } from "../constants";

/** Append-only log entries per run — backs the Execution Monitor and the Browser Automation Dashboard. */
const browserExecutionLogSchema = new Schema({
  runId: { type: String, required: true, index: true },
  level: { type: String, enum: BROWSER_EXECUTION_LOG_LEVELS, default: "info" },
  message: { type: String, required: true },
  data: { type: Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now, index: true },
});

browserExecutionLogSchema.index({ runId: 1, timestamp: 1 });

export type BrowserExecutionLogDoc = InferSchemaType<typeof browserExecutionLogSchema>;

export const BrowserExecutionLog: Model<BrowserExecutionLogDoc> =
  (models.BrowserExecutionLog as Model<BrowserExecutionLogDoc>) ??
  model<BrowserExecutionLogDoc>("BrowserExecutionLog", browserExecutionLogSchema);
