import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { PROJECT_STATUSES, VIDEO_STYLES } from "../constants";

// PROJECT_STATUSES/VIDEO_STYLES live in ../constants (no mongoose import) specifically so client
// components can import them without pulling this server-only model file into the browser bundle
// — see ../constants for why. Import from there, not from here.

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
    // "full": each step auto-enqueues the next once it can (core/queue/orchestrator.ts) — still stops
    // at manual hand-offs (video/lip-sync) since neither has a free API to call automatically.
    // "semi" (default): every step is user-triggered, matching the app's behavior before this field
    // existed. "manual": same as semi at the queue level — the distinction is in the UI, which leans
    // on named/reusable Prompt Library presets (modules/prompt-templates) rather than auto-chaining.
    pipelineMode: { type: String, enum: ["full", "semi", "manual"], default: "semi" },
    // The PDF's Music step (Suno/Udio/Epidemic/Artlist) has no approved-stack replacement — none of
    // those tools are on the allowed list, and no music-generation service is. Rather than silently
    // reaching for a forbidden tool, background music is a user-supplied upload (Cloudinary-stored),
    // optional, and skipped entirely in the render if not provided.
    musicAssetId: { type: Schema.Types.ObjectId, ref: "Asset" },
    watermarkImageUrl: { type: String },
    finalVideoAssetId: { type: Schema.Types.ObjectId, ref: "Asset" },
    thumbnailAssetId: { type: Schema.Types.ObjectId, ref: "Asset" },
    // Auto-derived from storyJson/style/characters alongside the thumbnail image — no extra AI call,
    // just composed from data already generated (title, description, tags).
    thumbnailTitle: { type: String },
    thumbnailDescription: { type: String },
    thumbnailTags: [{ type: String }],
  },
  { timestamps: true },
);

projectSchema.index({ userId: 1, updatedAt: -1 });

export type ProjectDoc = InferSchemaType<typeof projectSchema>;

export const Project: Model<ProjectDoc> = (models.Project as Model<ProjectDoc>) ?? model<ProjectDoc>("Project", projectSchema);
