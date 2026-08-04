import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const ASSET_KINDS = ["image", "video", "audio", "music", "thumbnail", "final_video"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

const assetSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    kind: { type: String, enum: ASSET_KINDS, required: true, index: true },
    cloudinaryPublicId: { type: String, required: true },
    url: { type: String, required: true },
    width: { type: Number },
    height: { type: Number },
    durationSeconds: { type: Number },
    bytes: { type: Number },
    version: { type: Number, default: 1 },
    replaces: { type: Schema.Types.ObjectId, ref: "Asset" },
  },
  { timestamps: true },
);

export type AssetDoc = InferSchemaType<typeof assetSchema>;

export const Asset: Model<AssetDoc> = (models.Asset as Model<AssetDoc>) ?? model<AssetDoc>("Asset", assetSchema);
