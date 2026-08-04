import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const SCENE_STATUSES = [
  "pending",
  "image_queued",
  "image_ready",
  "video_pending_manual",
  "video_ready",
  "voice_queued",
  "voice_ready",
  "lipsync_pending_manual",
  "lipsync_ready",
  "complete",
  "failed",
] as const;
export type SceneStatus = (typeof SCENE_STATUSES)[number];

const sceneSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    userId: { type: String, required: true, index: true },
    index: { type: Number, required: true },
    visual: { type: String, required: true },
    dialogue: { type: String, default: "" },
    camera: { type: String, default: "Medium shot" },
    emotion: { type: String, default: "Happy" },
    characterIds: [{ type: Schema.Types.ObjectId, ref: "Character" }],
    backgroundId: { type: Schema.Types.ObjectId, ref: "Background" },
    imageAssetId: { type: Schema.Types.ObjectId, ref: "Asset" },
    videoAssetId: { type: Schema.Types.ObjectId, ref: "Asset" },
    voiceAssetId: { type: Schema.Types.ObjectId, ref: "Asset" },
    // The lip-synced clip (PDF Step 7) — a new asset separate from videoAssetId, since the source
    // clip + voice track are kept too (re-running lip sync doesn't require regenerating either).
    lipSyncAssetId: { type: Schema.Types.ObjectId, ref: "Asset" },
    videoTaskId: { type: String }, // manual hand-off task id (Google Flow), see core/ai VideoProvider
    lipSyncTaskId: { type: String }, // manual hand-off task id (Hedra/HeyGen/Kling), see core/ai LipSyncProvider
    // Denormalized copy of the manual hand-off prompt so the Scene Manager can render it after a
    // page reload without re-fetching the originating Job (ARCHITECTURE.md §2).
    pendingVideoPrompt: { type: String },
    pendingVideoInstructions: { type: String },
    pendingLipSyncInstructions: { type: String },
    status: { type: String, enum: SCENE_STATUSES, default: "pending", index: true },
    failureReason: { type: String },
    // Set when an editable field this asset depends on changes after the asset was generated
    // (ARCHITECTURE.md §5's dependency-based invalidation) — see modules/scenes/dependencies.ts.
    // Cleared by the corresponding processor/upload route once that asset is regenerated.
    imageStale: { type: Boolean, default: false },
    videoStale: { type: Boolean, default: false },
    voiceStale: { type: Boolean, default: false },
    lipSyncStale: { type: Boolean, default: false },
  },
  { timestamps: true },
);

sceneSchema.index({ projectId: 1, index: 1 }, { unique: true });

export type SceneDoc = InferSchemaType<typeof sceneSchema>;

export const Scene: Model<SceneDoc> = (models.Scene as Model<SceneDoc>) ?? model<SceneDoc>("Scene", sceneSchema);
