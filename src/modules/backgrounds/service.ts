import type { HydratedDocument } from "mongoose";
import { connectToDatabase } from "@/core/db/mongoose";
import { Background, type BackgroundDoc } from "./models/Background";
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

/** Every background the user owns, across all projects — backs the /library page. */
export async function listAllBackgroundsForUser(userId: string) {
  await connectToDatabase();
  return Background.find({ userId }).sort({ createdAt: -1 }).populate("assetId").populate("projectId", "title").lean();
}

export type CloneBackgroundResult =
  | { ok: true; background: HydratedDocument<BackgroundDoc> }
  | { ok: false; error: "not_found" | "duplicate_name" };

/** Reuses an already-generated background in another project, without re-running image generation. */
export async function cloneBackgroundIntoProject(
  userId: string,
  backgroundId: string,
  targetProjectId: string,
): Promise<CloneBackgroundResult> {
  await connectToDatabase();
  const source = await Background.findOne({ _id: backgroundId, userId }).lean();
  if (!source) return { ok: false, error: "not_found" };

  const duplicate = await Background.exists({ userId, projectId: targetProjectId, name: source.name });
  if (duplicate) return { ok: false, error: "duplicate_name" };

  const { _id, createdAt, updatedAt, projectId, ...rest } = source;
  void _id;
  void createdAt;
  void updatedAt;
  void projectId;
  const background = await Background.create({ ...rest, userId, projectId: targetProjectId });
  return { ok: true, background };
}
