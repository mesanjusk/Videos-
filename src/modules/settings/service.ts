import { connectToDatabase } from "@/core/db/mongoose";
import { Settings } from "./models/Settings";
import type { AiCapability } from "@/core/ai/types";

export async function getOrCreateSettings(userId: string) {
  await connectToDatabase();
  let doc = await Settings.findOne({ userId });
  if (!doc) {
    doc = await Settings.create({ userId });
  }
  return doc;
}

/** Read by queue processors before resolving a provider — returns `undefined` for "use the env default". */
export async function getProviderOverride(userId: string, capability: AiCapability): Promise<string | undefined> {
  await connectToDatabase();
  const doc = await Settings.findOne({ userId }).lean();
  return doc?.providerOverrides?.[capability] ?? undefined;
}

export async function setProviderOverride(userId: string, capability: AiCapability, providerId: string) {
  await connectToDatabase();
  return Settings.findOneAndUpdate(
    { userId },
    { $set: { [`providerOverrides.${capability}`]: providerId } },
    { new: true, upsert: true },
  );
}

export async function setDefaultLanguage(userId: string, language: string) {
  await connectToDatabase();
  return Settings.findOneAndUpdate({ userId }, { $set: { defaultLanguage: language } }, { new: true, upsert: true });
}
