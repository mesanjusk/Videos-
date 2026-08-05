import { connectToDatabase } from "@/core/db/mongoose";
import { VoicePack } from "./models/VoicePack";
import type { CreateVoicePackInput, UpdateVoicePackInput } from "./schema";

export async function listVoicePacks(userId: string) {
  await connectToDatabase();
  return VoicePack.find({ userId }).sort({ name: 1 }).lean();
}

export async function getVoicePack(userId: string, id: string) {
  await connectToDatabase();
  return VoicePack.findOne({ _id: id, userId }).lean();
}

export async function createVoicePack(userId: string, input: CreateVoicePackInput) {
  await connectToDatabase();
  return VoicePack.create({ userId, ...input });
}

export async function updateVoicePack(userId: string, id: string, patch: UpdateVoicePackInput) {
  await connectToDatabase();
  return VoicePack.findOneAndUpdate({ _id: id, userId }, { $set: patch }, { new: true });
}

export async function deleteVoicePack(userId: string, id: string) {
  await connectToDatabase();
  await VoicePack.deleteOne({ _id: id, userId });
}
