import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/**
 * A persisted Playwright `storageState()`, generic across providers — deliberately NOT modeled as
 * a `GoogleAccount` field the way Module 4's Flow session is, because future providers (Veo,
 * Runway, Kling, Pika, ...) won't all be "Google accounts". Encrypted at rest with the same
 * AES-256-GCM helper Module 4 already uses for the Flow session (`core/auth/encryption.ts`).
 */
const browserSessionSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    providerId: { type: String, required: true },
    label: { type: String, required: true },
    // `select: false` so the ciphertext is not loaded — and therefore cannot be serialised into an
    // API response — unless a caller explicitly asks with `.select("+storageStateEnc")`. Only the
    // worker asks. Before the merge this relied on every query remembering to write
    // `-storageStateEnc`; one forgotten exclusion would have put an encrypted browser session in a
    // JSON response. Failing closed is the right default for a field like this.
    storageStateEnc: { type: String, required: true, select: false },
    connectedAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date },
  },
  { timestamps: true },
);

browserSessionSchema.index({ userId: 1, providerId: 1, label: 1 }, { unique: true });

export type BrowserSessionDoc = InferSchemaType<typeof browserSessionSchema>;

export const BrowserSession: Model<BrowserSessionDoc> =
  (models.BrowserSession as Model<BrowserSessionDoc>) ?? model<BrowserSessionDoc>("BrowserSession", browserSessionSchema);
