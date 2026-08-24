import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { PRODUCTION_PROFILE_STATUSES } from "../constants";

export type { ProductionProfileStatus } from "../constants";

/**
 * A named, reusable production pipeline — the "Module 6" entity everything else in this file
 * references rather than duplicates: `characterIds` points at existing Character Library entries
 * (Module 1), `promptTemplateIds` points at existing named PromptTemplate presets (never a second
 * copy of prompt text), `stylePackId`/`voicePackId` point at StylePack/VoicePack. Only genuinely
 * new, profile-specific configuration (quality thresholds, render preferences) is stored inline —
 * see docs/PRODUCTION-ENGINE-PLAN.md for why that split, not everything normalized into its own
 * collection.
 */
const productionProfileSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String },
    category: { type: String },
    version: { type: Number, default: 1 },
    status: { type: String, enum: PRODUCTION_PROFILE_STATUSES, default: "draft" },

    language: { type: String, default: "en" },
    aspectRatio: { type: String, default: "9:16" },
    resolution: {
      width: { type: Number, default: 1080 },
      height: { type: Number, default: 1920 },
    },
    fps: { type: Number, default: 30 },
    sceneDurationSeconds: { type: Number, default: 8 },
    defaultSceneCount: { type: Number, default: 8 },

    characterIds: [{ type: Schema.Types.ObjectId, ref: "Character" }],
    stylePackId: { type: Schema.Types.ObjectId, ref: "StylePack" },
    voicePackId: { type: Schema.Types.ObjectId, ref: "VoicePack" },
    // References specific named PromptTemplate docs (each already scoped to one of
    // PROMPT_SCOPES) — pinning a profile to particular presets rather than whatever's currently
    // marked isDefault. See modules/prompt-templates for the existing named-preset support this
    // reuses unchanged.
    promptTemplateIds: [{ type: Schema.Types.ObjectId, ref: "PromptTemplate" }],

    quality: {
      minResolutionWidth: { type: Number, default: 1080 },
      minResolutionHeight: { type: Number, default: 1350 },
      minSceneDurationSeconds: { type: Number, default: 5 },
      maxSceneDurationSeconds: { type: Number, default: 8 },
      characterConsistencyThreshold: { type: Number, default: 0.45 },
      retryStrategy: { type: String, enum: ["none", "quality-triggered", "aggressive"], default: "quality-triggered" },
    },
    render: {
      // Which RenderProvider composes the final video (core/render). "ffmpeg" is the default and
      // the fallback; "hybrid" adds HyperFrames-composed HTML overlays on top of the same FFmpeg
      // composition. FFmpeg is never replaced — see docs/RENDERING.md.
      renderer: { type: String, enum: ["ffmpeg", "hyperframes", "hybrid"], default: "ffmpeg" },
      // Cost policy in force for productions started from this profile. "BALANCED" preserves the
      // behaviour every existing profile already has; "ZERO_COST" refuses any metered provider.
      costPolicy: { type: String, enum: ["ZERO_COST", "FREE_PREFERRED", "BALANCED", "BEST_QUALITY"], default: "BALANCED" },
      // Let a video stage divert to browser automation when no API route is available.
      browserFallback: { type: Boolean, default: false },
      oneSceneAtATime: { type: Boolean, default: true },
      maxParallelJobs: { type: Number, default: 2 },
      // Same shape as Settings.providerOverrides (core/ai/types.ts's AiCapability keys) —
      // deliberately provider-agnostic. Stored as an abstraction layer only in this module; not
      // yet consumed by any processor (no browser automation or provider-selection change is part
      // of Module 6 — see docs/PRODUCTION-ENGINE-PLAN.md).
      providerOverrides: {
        story: { type: String },
        image: { type: String },
        video: { type: String },
        voice: { type: String },
        lipsync: { type: String },
      },
      retryDelaySeconds: { type: Number, default: 30 },
      automaticContinuation: { type: Boolean, default: true },
      recoveryStrategy: { type: String, enum: ["retry", "manual-handoff", "skip"], default: "manual-handoff" },
    },
  },
  { timestamps: true },
);

productionProfileSchema.index({ userId: 1, name: 1 }, { unique: true });

export type ProductionProfileDoc = InferSchemaType<typeof productionProfileSchema>;

export const ProductionProfile: Model<ProductionProfileDoc> =
  (models.ProductionProfile as Model<ProductionProfileDoc>) ??
  model<ProductionProfileDoc>("ProductionProfile", productionProfileSchema);
