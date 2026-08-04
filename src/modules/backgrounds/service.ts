import { connectToDatabase } from "@/core/db/mongoose";
import { Background } from "./models/Background";
import type { CreateBackgroundInput } from "./schema";

export async function createBackground(userId: string, projectId: string, style: string, input: CreateBackgroundInput) {
  await connectToDatabase();
  return Background.create({
    userId,
    projectId,
    name: input.name,
    category: input.category,
    description: input.description,
    lighting: input.lighting,
    style,
  });
}

export async function listBackgrounds(userId: string, projectId: string) {
  await connectToDatabase();
  return Background.find({ userId, projectId }).sort({ createdAt: 1 }).populate("assetId").lean();
}

export async function getBackground(userId: string, backgroundId: string) {
  await connectToDatabase();
  return Background.findOne({ _id: backgroundId, userId }).lean();
}

export async function deleteBackground(userId: string, backgroundId: string) {
  await connectToDatabase();
  await Background.deleteOne({ _id: backgroundId, userId });
}
