import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { CREDENTIAL_TYPES } from "../constants";

/**
 * A secret a workflow can reference as `{{secret:<name>}}`.
 *
 * The value is AES-256-GCM encrypted and `select: false`, so it is never loaded — and therefore
 * never serialisable into an API response — unless a caller explicitly asks for it. Only the
 * worker ever asks: `core/browser/interpolate.ts` resolves the token straight into the Playwright
 * call and never writes the plaintext back into the run's variable bag, which is what gets
 * persisted, logged and shown in the dashboard.
 *
 * `metadata` is for non-sensitive context only (a username, a site) — anything secret belongs in
 * `valueEnc`.
 */
const credentialSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    type: { type: String, enum: CREDENTIAL_TYPES, default: "password" },
    browserSessionId: { type: Schema.Types.ObjectId, ref: "BrowserSession" },
    valueEnc: { type: String, required: true, select: false },
    metadata: { type: Schema.Types.Mixed },
    lastUsedAt: { type: Date },
  },
  { timestamps: true },
);

credentialSchema.index({ userId: 1, name: 1 }, { unique: true });

export type CredentialDoc = InferSchemaType<typeof credentialSchema>;
export const Credential: Model<CredentialDoc> =
  (models.Credential as Model<CredentialDoc>) ?? model<CredentialDoc>("Credential", credentialSchema);
