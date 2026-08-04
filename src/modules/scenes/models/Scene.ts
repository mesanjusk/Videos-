import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const SCENE_STATUSES = [
  "pending",
  "image_queued",
  "image_ready",
  "video_pending_manual",
  "video_ready",
  "voice_queued",
  "voice_ready",
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
    videoTaskId: { type: String }, // manual hand-off task id (Google Flow), see core/ai VideoProvider
    status: { type: String, enum: SCENE_STATUSES, default: "pending", index: true },
    failureReason: { type: String },
  },
  { timestamps: true },
);

sceneSchema.index({ projectId: 1, index: 1 }, { unique: true });

export type SceneDoc = InferSchemaType<typeof sceneSchema>;

export const Scene: Model<SceneDoc> = (models.Scene as Model<SceneDoc>) ?? model<SceneDoc>("Scene", sceneSchema);
