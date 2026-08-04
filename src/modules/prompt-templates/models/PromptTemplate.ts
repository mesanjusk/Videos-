import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const PROMPT_SCOPES = ["story", "character", "background", "scene_image", "scene_video", "voice", "thumbnail", "music"] as const;

const promptTemplateSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    scope: { type: String, enum: PROMPT_SCOPES, required: true, index: true },
    name: { type: String, required: true },
    template: { type: String, required: true },
    variables: [{ type: String }],
    appendConsistencyFormula: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true },
);

promptTemplateSchema.index({ userId: 1, scope: 1, name: 1 }, { unique: true });

export type PromptTemplateDoc = InferSchemaType<typeof promptTemplateSchema>;

export const PromptTemplate: Model<PromptTemplateDoc> =
  (models.PromptTemplate as Model<PromptTemplateDoc>) ?? model<PromptTemplateDoc>("PromptTemplate", promptTemplateSchema);
