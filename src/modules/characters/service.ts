import type { HydratedDocument } from "mongoose";
import { connectToDatabase } from "@/core/db/mongoose";
import { Character, type CharacterDoc } from "./models/Character";
import type { CreateCharacterInput } from "./schema";

export async function createCharacter(userId: string, projectId: string, input: CreateCharacterInput) {
  await connectToDatabase();
  return Character.create({
    userId,
    projectId,
    name: input.name,
    role: input.role,
    spec: {
      age: input.age,
      bodyType: input.bodyType,
      face: input.face,
      eyes: input.eyes,
      hair: input.hair,
      clothes: input.clothes,
      shoes: input.shoes,
      accessories: input.accessories,
      personality: input.personality,
    },
  });
}

export async function listCharacters(userId: string, projectId: string) {
  await connectToDatabase();
  return Character.find({ userId, projectId }).sort({ createdAt: 1 }).populate("sheetAssets.assetId").lean();
}

export async function getCharacter(userId: string, characterId: string) {
  await connectToDatabase();
  return Character.findOne({ _id: characterId, userId }).lean();
}

export async function deleteCharacter(userId: string, characterId: string) {
  await connectToDatabase();
  await Character.deleteOne({ _id: characterId, userId });
}

/** Every character the user owns, across all projects — backs the /library page (character memory). */
export async function listAllCharactersForUser(userId: string) {
  await connectToDatabase();
  return Character.find({ userId })
    .sort({ createdAt: -1 })
    .populate("sheetAssets.assetId")
    .populate("projectId", "title")
    .lean();
}

export type CloneCharacterResult =
  | { ok: true; character: HydratedDocument<CharacterDoc> }
  | { ok: false; error: "not_found" | "duplicate_name" };

/**
 * Reuses a character (face, outfit, voice, style, prompt template) in another project — e.g. episode 2
 * of a series — by copying the document rather than re-running any generation. sheetAssets keep
 * pointing at the same already-generated Cloudinary images, so no image regeneration is needed.
 */
export async function cloneCharacterIntoProject(
  userId: string,
  characterId: string,
  targetProjectId: string,
): Promise<CloneCharacterResult> {
  await connectToDatabase();
  const source = await Character.findOne({ _id: characterId, userId }).lean();
  if (!source) return { ok: false, error: "not_found" };

  const duplicate = await Character.exists({ userId, projectId: targetProjectId, name: source.name });
  if (duplicate) return { ok: false, error: "duplicate_name" };

  const { _id, createdAt, updatedAt, projectId, ...rest } = source;
  void _id;
  void createdAt;
  void updatedAt;
  void projectId;
  const character = await Character.create({ ...rest, userId, projectId: targetProjectId });
  return { ok: true, character };
}
