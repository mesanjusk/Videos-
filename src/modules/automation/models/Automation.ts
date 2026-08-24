import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/**
 * A runnable configuration of a workflow: which browser profile it uses, what inputs it defaults
 * to, where to call back when it finishes. The workflow is the "what"; the automation is the
 * "how and with which account".
 */
const automationSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String },
    workflowId: { type: Schema.Types.ObjectId, ref: "Workflow", required: true, index: true },
    /** A persisted browser session/profile from modules/browser-automation. */
    browserSessionId: { type: Schema.Types.ObjectId, ref: "BrowserSession" },
    defaultInput: { type: Schema.Types.Mixed, default: {} },
    /** Outbound URL called when a run of this automation finishes. Delivered via the webhook queue. */
    callbackUrl: { type: String },
    enabled: { type: Boolean, default: true, index: true },
    lastRunAt: { type: Date },
  },
  { timestamps: true },
);

automationSchema.index({ userId: 1, name: 1 }, { unique: true });

export type AutomationDoc = InferSchemaType<typeof automationSchema>;
export const Automation: Model<AutomationDoc> =
  (models.Automation as Model<AutomationDoc>) ?? model<AutomationDoc>("Automation", automationSchema);
