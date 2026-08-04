import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const characterSpecSchema = new Schema(
  {
    age: String,
    bodyType: String,
    face: String,
    eyes: String,
    hair: String,
    clothes: String,
    shoes: String,
    accessories: String,
    personality: String,
  },
  { _id: false },
);

const sheetAssetSchema = new Schema(
  {
    pose: { type: String, required: true }, // CharacterPose, see core/ai/types.ts
    assetId: { type: Schema.Types.ObjectId, ref: "Asset", required: true },
  },
  { _id: false },
);

const characterSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    role: { type: String },
    spec: { type: characterSpecSchema, default: {} },
    sheetAssets: [sheetAssetSchema],
    voiceProfile: {
      gender: { type: String, enum: ["male", "female", "neutral"] },
      age: Number,
      tone: String,
    },
    promptTemplateId: { type: Schema.Types.ObjectId, ref: "PromptTemplate" },
    version: { type: Number, default: 1 },
    previousVersions: [{ type: Schema.Types.Mixed }],
  },
  { timestamps: true },
);

characterSchema.index({ projectId: 1, name: 1 }, { unique: true });

export type CharacterDoc = InferSchemaType<typeof characterSchema>;

export const Character: Model<CharacterDoc> =
  (models.Character as Model<CharacterDoc>) ?? model<CharacterDoc>("Character", characterSchema);
