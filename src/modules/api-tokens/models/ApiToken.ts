import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/**
 * Personal API tokens — the machine-auth counterpart to the browser session (NextAuth cookie).
 * Exists so non-browser clients (the Claude Code plugin's MCP server, CI, scripts) can call this
 * app's REST API as a given user without a cookie jar. Distinct from `GoogleAccount` (§3 of
 * ARCHITECTURE.md, which pools Gemini/Flow credentials this app uses *outward* toward Google) —
 * an `ApiToken` authenticates *inbound* callers of this app's own API.
 *
 * Only `tokenHash` (SHA-256 of the raw token) is stored — the raw token is shown exactly once, at
 * creation, and never persisted or logged (see modules/api-tokens/service.ts#createApiToken).
 */
const apiTokenSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    tokenHash: { type: String, required: true, unique: true },
    // First 8 chars of the raw token, kept in the clear so a user can tell tokens apart in the UI
    // without the full secret ever being displayed or stored again after creation.
    tokenPrefix: { type: String, required: true },
    lastUsedAt: { type: Date },
  },
  { timestamps: true },
);

export type ApiTokenDoc = InferSchemaType<typeof apiTokenSchema>;

export const ApiToken: Model<ApiTokenDoc> = (models.ApiToken as Model<ApiTokenDoc>) ?? model<ApiTokenDoc>("ApiToken", apiTokenSchema);
