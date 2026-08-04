import { connectToDatabase } from "@/core/db/mongoose";
import { Character } from "./models/Character";
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
