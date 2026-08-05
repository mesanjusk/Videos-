import { connectToDatabase } from "@/core/db/mongoose";
import { ProductionProfile } from "./models/ProductionProfile";
import type { CreateProductionProfileInput, UpdateProductionProfileInput } from "./schema";

export async function listProductionProfiles(userId: string) {
  await connectToDatabase();
  return ProductionProfile.find({ userId }).sort({ updatedAt: -1 }).lean();
}

export async function getProductionProfile(userId: string, id: string) {
  await connectToDatabase();
  return ProductionProfile.findOne({ _id: id, userId }).lean();
}

/** Populated with everything generate.ts needs in one query — characters/style/voice/prompt refs
 * resolved, never copied. */
export async function getProductionProfileForGeneration(userId: string, id: string) {
  await connectToDatabase();
  return ProductionProfile.findOne({ _id: id, userId })
    .populate("characterIds")
    .populate("stylePackId")
    .populate("voicePackId")
    .populate("promptTemplateIds")
    .lean();
}

export async function createProductionProfile(userId: string, input: CreateProductionProfileInput) {
  await connectToDatabase();
  return ProductionProfile.create({ userId, ...input });
}

/** Bumps `version` whenever the profile's actual production-affecting fields change — ProductionRun
 * snapshots `profileVersion` at generation time, so history stays accurate after a later edit. */
export async function updateProductionProfile(userId: string, id: string, patch: UpdateProductionProfileInput) {
  await connectToDatabase();
  const profile = await ProductionProfile.findOne({ _id: id, userId });
  if (!profile) return null;
  Object.assign(profile, patch);
  profile.version = (profile.version ?? 1) + 1;
  await profile.save();
  return profile;
}

export async function deleteProductionProfile(userId: string, id: string) {
  await connectToDatabase();
  await ProductionProfile.deleteOne({ _id: id, userId });
}
