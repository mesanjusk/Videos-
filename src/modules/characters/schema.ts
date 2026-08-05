import { z } from "zod";

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #1B4965");

export const createCharacterSchema = z.object({
  name: z.string().min(1).max(60),
  role: z.string().max(60).optional(),
  age: z.string().max(60).optional(),
  bodyType: z.string().max(120).optional(),
  face: z.string().max(200).optional(),
  eyes: z.string().max(120).optional(),
  hair: z.string().max(120).optional(),
  clothes: z.string().max(200).optional(),
  shoes: z.string().max(120).optional(),
  accessories: z.string().max(200).optional(),
  personality: z.string().max(200).optional(),
  masterPrompt: z.string().max(2000).optional(),
  animationStyle: z.string().max(60).optional(),
  colorPalette: z.array(hexColor).max(8).optional(),
});

export type CreateCharacterInput = z.infer<typeof createCharacterSchema>;

// All fields optional — PATCH applies only what's provided. Editing any of `spec`/`masterPrompt`/
// `animationStyle`/`colorPalette`/`voiceProfile` snapshots the previous state into
// `previousVersions` first (see modules/characters/service.ts#updateCharacter).
export const updateCharacterSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  role: z.string().max(60).optional(),
  age: z.string().max(60).optional(),
  bodyType: z.string().max(120).optional(),
  face: z.string().max(200).optional(),
  eyes: z.string().max(120).optional(),
  hair: z.string().max(120).optional(),
  clothes: z.string().max(200).optional(),
  shoes: z.string().max(120).optional(),
  accessories: z.string().max(200).optional(),
  personality: z.string().max(200).optional(),
  masterPrompt: z.string().max(2000).optional(),
  animationStyle: z.string().max(60).optional(),
  colorPalette: z.array(hexColor).max(8).optional(),
  voiceProfile: z
    .object({
      gender: z.enum(["male", "female", "neutral"]).optional(),
      age: z.number().min(0).max(200).optional(),
      tone: z.string().max(120).optional(),
    })
    .optional(),
});

export type UpdateCharacterInput = z.infer<typeof updateCharacterSchema>;

export const assignCharacterSchema = z.object({
  targetProjectId: z.string().min(1),
});

export type AssignCharacterInput = z.infer<typeof assignCharacterSchema>;
