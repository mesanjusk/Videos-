import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/** Per-provider settings, referenced (not duplicated) by whichever ProviderAdapter registers under
 * `providerId` — e.g. timeouts/retry policy a future Google Flow / Veo / Runway adapter reads. */
const browserProviderConfigSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    providerId: { type: String, required: true },
    label: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    timeoutMs: { type: Number, default: 60_000 },
    maxAttempts: { type: Number, default: 3 },
    backoffMs: { type: Number, default: 2_000 },
    settings: { type: Schema.Types.Mixed }, // opaque, provider-defined
  },
  { timestamps: true },
);

browserProviderConfigSchema.index({ userId: 1, providerId: 1 }, { unique: true });

export type BrowserProviderConfigDoc = InferSchemaType<typeof browserProviderConfigSchema>;

export const BrowserProviderConfig: Model<BrowserProviderConfigDoc> =
  (models.BrowserProviderConfig as Model<BrowserProviderConfigDoc>) ??
  model<BrowserProviderConfigDoc>("BrowserProviderConfig", browserProviderConfigSchema);
