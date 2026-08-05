import { connectToDatabase } from "@/core/db/mongoose";
import { StylePack } from "./models/StylePack";
import type { CreateStylePackInput, UpdateStylePackInput } from "./schema";

export async function listStylePacks(userId: string) {
  await connectToDatabase();
  return StylePack.find({ userId }).sort({ name: 1 }).lean();
}

export async function getStylePack(userId: string, id: string) {
  await connectToDatabase();
  return StylePack.findOne({ _id: id, userId }).lean();
}

export async function createStylePack(userId: string, input: CreateStylePackInput) {
  await connectToDatabase();
  return StylePack.create({ userId, ...input });
}

export async function updateStylePack(userId: string, id: string, patch: UpdateStylePackInput) {
  await connectToDatabase();
  return StylePack.findOneAndUpdate({ _id: id, userId }, { $set: patch }, { new: true });
}

export async function deleteStylePack(userId: string, id: string) {
  await connectToDatabase();
  await StylePack.deleteOne({ _id: id, userId });
}
