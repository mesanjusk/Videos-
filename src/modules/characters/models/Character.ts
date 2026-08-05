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
    // "Home" project — where the character was first created. Optional so a character can be
    // authored directly into the library with no project yet. Cross-project reuse is tracked
    // separately via `usedInProjectIds` rather than by copying the document (see
    // modules/characters/service.ts#assignCharacterToProject) — one character, many projects.
    projectId: { type: Schema.Types.ObjectId, ref: "Project", index: true },
    usedInProjectIds: [{ type: Schema.Types.ObjectId, ref: "Project", index: true }],
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    role: { type: String },
    spec: { type: characterSpecSchema, default: {} },
    // The canonical, editable description fed into every prompt template that references this
    // character (character sheet, scene image/video, thumbnail) — the PDF's "master prompt"
    // concept, kept independent of `spec`'s individual attribute fields so a producer can hand-tune
    // the exact wording without fighting the structured form.
    masterPrompt: { type: String },
    animationStyle: { type: String }, // e.g. Pixar / Disney / Anime / Realistic / 3D / Custom — overrides the project's style for this character specifically
    colorPalette: [{ type: String }], // hex codes, e.g. "#1B4965"
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

characterSchema.index({ userId: 1, name: 1 });

export type CharacterDoc = InferSchemaType<typeof characterSchema>;

export const Character: Model<CharacterDoc> =
  (models.Character as Model<CharacterDoc>) ?? model<CharacterDoc>("Character", characterSchema);
