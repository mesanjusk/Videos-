import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const settingsSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    providerOverrides: {
      story: { type: String },
      image: { type: String },
      video: { type: String },
      voice: { type: String },
    },
    theme: { type: String, enum: ["light", "dark", "system"], default: "system" },
    defaultLanguage: { type: String, default: "en" },
  },
  { timestamps: true },
);

export type SettingsDoc = InferSchemaType<typeof settingsSchema>;

export const Settings: Model<SettingsDoc> = (models.Settings as Model<SettingsDoc>) ?? model<SettingsDoc>("Settings", settingsSchema);
