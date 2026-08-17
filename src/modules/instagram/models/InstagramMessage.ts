import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/**
 * Append-only log of inbound DMs and the auto-reply (if any) sent back — powers the "recent
 * activity" list on /instagram and is the only record of what the auto-reply actually said, since
 * Meta's own inbox doesn't expose that back to us.
 */
const instagramMessageSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    instagramAccountId: { type: Schema.Types.ObjectId, ref: "InstagramAccount", required: true, index: true },
    senderId: { type: String, required: true }, // the customer's IG-scoped id, not their username
    incomingText: { type: String, required: true },
    replyText: { type: String },
    status: { type: String, enum: ["replied", "failed", "skipped"], required: true },
    error: { type: String },
  },
  { timestamps: true },
);

export type InstagramMessageDoc = InferSchemaType<typeof instagramMessageSchema>;

export const InstagramMessage: Model<InstagramMessageDoc> =
  (models.InstagramMessage as Model<InstagramMessageDoc>) ??
  model<InstagramMessageDoc>("InstagramMessage", instagramMessageSchema);
