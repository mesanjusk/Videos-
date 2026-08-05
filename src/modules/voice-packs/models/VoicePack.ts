import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

/**
 * A reusable, named voice default — referenced by ProductionProfile as a fallback. A character's
 * own `voiceProfile` (modules/characters/models/Character.ts) always wins when set; this only
 * fills in for characters that don't have one, the same "more specific setting wins" pattern
 * Settings.providerOverrides already uses.
 */
const voicePackSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    gender: { type: String, enum: ["male", "female", "child", "narrator"], default: "narrator" },
    language: { type: String, default: "en" },
    speakingSpeed: { type: Number, default: 1 }, // 1 = normal
    emotion: { type: String },
  },
  { timestamps: true },
);

voicePackSchema.index({ userId: 1, name: 1 }, { unique: true });

export type VoicePackDoc = InferSchemaType<typeof voicePackSchema>;

export const VoicePack: Model<VoicePackDoc> =
  (models.VoicePack as Model<VoicePackDoc>) ?? model<VoicePackDoc>("VoicePack", voicePackSchema);
