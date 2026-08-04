import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const PROJECT_STATUSES = [
  "draft",
  "story",
  "characters",
  "backgrounds",
  "scenes",
  "rendering",
  "done",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const VIDEO_STYLES = ["Pixar", "Disney", "Anime", "Realistic", "3D", "Custom"] as const;

const storySceneSchema = new Schema(
  {
    index: { type: Number, required: true },
    visual: { type: String, required: true },
    dialogue: { type: String, required: true },
    camera: { type: String, required: true },
    emotion: { type: String, required: true },
  },
  { _id: false },
);

const projectSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    language: { type: String, default: "en" },
    videoType: { type: String, default: "short" }, // e.g. "short" | "series-episode" | "explainer"
    durationSeconds: { type: Number, default: 60 },
    targetPlatform: { type: String, default: "youtube" }, // youtube | instagram | tiktok | ...
    style: { type: String, enum: VIDEO_STYLES, default: "Pixar" },
    customStyleDescription: { type: String }, // used when style === "Custom"
    storyInputMode: { type: String, enum: ["idea", "script"], default: "idea" },
    premise: { type: String }, // storyInputMode === "idea": a short idea for Gemini to expand
    pastedScript: { type: String }, // storyInputMode === "script": a full script to structure into storyJson
    storyJson: {
      title: { type: String },
      characters: [{ name: String, role: String }],
      scenes: [storySceneSchema],
    },
    status: { type: String, enum: PROJECT_STATUSES, default: "draft", index: true },
    completionPercent: { type: Number, default: 0, min: 0, max: 100 },
    finalVideoAssetId: { type: Schema.Types.ObjectId, ref: "Asset" },
    thumbnailAssetId: { type: Schema.Types.ObjectId, ref: "Asset" },
  },
  { timestamps: true },
);

projectSchema.index({ userId: 1, updatedAt: -1 });

export type ProjectDoc = InferSchemaType<typeof projectSchema>;

export const Project: Model<ProjectDoc> = (models.Project as Model<ProjectDoc>) ?? model<ProjectDoc>("Project", projectSchema);
