import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/**
 * A pooled Google account the app can generate on behalf of a user (see ARCHITECTURE.md §3).
 * Distinct from the user's app login session (NextAuth) — this is purely a generation-credential pool.
 */
const googleAccountSchema = new Schema(
  {
    userId: { type: String, required: true, index: true }, // NextAuth user id (owner, app-side)
    email: { type: String, required: true },
    displayName: { type: String, required: true },
    avatarUrl: { type: String },
    credentials: {
      apiKeyEnc: { type: String, required: true }, // AES-256-GCM ciphertext, see core/auth/encryption.ts
      // Playwright `storageState()` JSON (cookies + localStorage) from a browser session where this
      // account manually logged into Google once — AES-256-GCM ciphertext, same as apiKeyEnc.
      // Optional: the Browser Automation Engine (core/automation) only works for accounts that have
      // one. We never automate the Google login itself — see docs/MOVIE-STUDIO-ROADMAP.md Module 4.
      flowSessionStateEnc: { type: String },
    },
    flowSessionConnectedAt: { type: Date },
    status: {
      type: String,
      enum: ["active", "disabled", "quota_exceeded", "error"],
      default: "active",
      index: true,
    },
    isDefault: { type: Boolean, default: false },
    quota: {
      dailyLimit: { type: Number, default: 0 }, // 0 = unknown/unbounded until the provider reports otherwise
      used: { type: Number, default: 0 },
      resetsAt: { type: Date },
      lastError: { type: String },
    },
    lastUsedAt: { type: Date },
    currentJobIds: [{ type: Schema.Types.ObjectId, ref: "Job" }],
  },
  { timestamps: true },
);

googleAccountSchema.index({ userId: 1, email: 1 }, { unique: true });

export type GoogleAccountDoc = InferSchemaType<typeof googleAccountSchema>;

export const GoogleAccount: Model<GoogleAccountDoc> =
  (models.GoogleAccount as Model<GoogleAccountDoc>) ?? model<GoogleAccountDoc>("GoogleAccount", googleAccountSchema);
