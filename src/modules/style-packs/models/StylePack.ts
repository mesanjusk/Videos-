import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { VIDEO_STYLES } from "@/modules/projects/constants";

/**
 * A reusable, named visual style — e.g. "Ultra Realistic", "Mythology Epic" — referenced by
 * ProductionProfile, never copied into it. `category` maps onto the same VIDEO_STYLES enum
 * Project.style already uses ("Custom" when the pack is more specific than the enum covers), so
 * generating a project from a profile with a style pack sets Project.style/customStyleDescription
 * through the exact mechanism every image/video processor already reads — no processor changes
 * needed for style packs to work (see core/production-engine/style-description.ts).
 */
const stylePackSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    category: { type: String, enum: VIDEO_STYLES, default: "Custom" },
    lighting: { type: String },
    colorGrading: { type: String },
    cameraStyle: { type: String },
    composition: { type: String },
    motionStyle: { type: String },
    renderStyle: { type: String },
  },
  { timestamps: true },
);

stylePackSchema.index({ userId: 1, name: 1 }, { unique: true });

export type StylePackDoc = InferSchemaType<typeof stylePackSchema>;

export const StylePack: Model<StylePackDoc> =
  (models.StylePack as Model<StylePackDoc>) ?? model<StylePackDoc>("StylePack", stylePackSchema);
