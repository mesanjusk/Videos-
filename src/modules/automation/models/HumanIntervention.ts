import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { HUMAN_INTERVENTION_REASONS } from "../constants";

/**
 * A run that stopped and is waiting on a person — a CAPTCHA, an MFA prompt, an explicit
 * HUMAN_APPROVAL node, or a page the automation could not make sense of.
 *
 * This is the honest alternative to the two things automation is tempted to do instead: solve the
 * challenge (which this codebase will not do) or retry blindly until it gives up. The run holds its
 * resume point and waits.
 */
const humanInterventionSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    taskId: { type: Schema.Types.ObjectId, ref: "AutomationTask", required: true, index: true },
    stepId: { type: String },
    reason: { type: String, enum: HUMAN_INTERVENTION_REASONS, required: true },
    message: { type: String, required: true },
    screenshotFileId: { type: Schema.Types.ObjectId, ref: "StoredFile" },
    status: { type: String, enum: ["pending", "approved", "rejected", "resolved"], default: "pending", index: true },
    requestedAt: { type: Date, default: () => new Date() },
    resolvedAt: { type: Date },
  },
  { timestamps: false },
);

export type HumanInterventionDoc = InferSchemaType<typeof humanInterventionSchema>;
export const HumanIntervention: Model<HumanInterventionDoc> =
  (models.HumanIntervention as Model<HumanInterventionDoc>) ??
  model<HumanInterventionDoc>("HumanIntervention", humanInterventionSchema);
