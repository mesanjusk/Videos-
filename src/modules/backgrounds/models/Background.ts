import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const BACKGROUND_CATEGORIES = [
  "indoor",
  "outdoor",
  "forest",
  "temple",
  "city",
  "village",
  "beach",
  "mountains",
  "custom",
] as const;

const backgroundSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    category: { type: String, enum: BACKGROUND_CATEGORIES, default: "custom" },
    description: { type: String, required: true },
    style: { type: String, required: true },
    lighting: { type: String, default: "morning" },
    assetId: { type: Schema.Types.ObjectId, ref: "Asset" },
    promptTemplateId: { type: Schema.Types.ObjectId, ref: "PromptTemplate" },
  },
  { timestamps: true },
);

export type BackgroundDoc = InferSchemaType<typeof backgroundSchema>;

export const Background: Model<BackgroundDoc> =
  (models.Background as Model<BackgroundDoc>) ?? model<BackgroundDoc>("Background", backgroundSchema);
