import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/**
 * An outbound webhook subscription. The application already had *inbound* webhooks (Instagram);
 * this is the other direction, ported from Browser Automation OS — telling an external system that
 * a run finished.
 *
 * `secretEnc` is `select: false` and encrypted, following the discipline Project B applied to every
 * secret-bearing field: a careless `.lean()` or a `res.json(doc)` cannot leak it, because it is not
 * loaded unless explicitly asked for.
 */
const webhookSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    url: { type: String, required: true },
    events: { type: [String], default: ["automation.completed", "automation.failed"] },
    /** AES-256-GCM. Used to sign the delivery body so the receiver can verify it came from here. */
    secretEnc: { type: String, select: false },
    automationId: { type: Schema.Types.ObjectId, ref: "Automation" },
    enabled: { type: Boolean, default: true },
    lastDeliveryAt: { type: Date },
    lastDeliveryStatus: { type: String, enum: ["success", "failed"] },
    lastDeliveryError: { type: String },
  },
  { timestamps: true },
);

export type WebhookDoc = InferSchemaType<typeof webhookSchema>;
export const Webhook: Model<WebhookDoc> =
  (models.Webhook as Model<WebhookDoc>) ?? model<WebhookDoc>("Webhook", webhookSchema);
