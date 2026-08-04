import { connectToDatabase } from "@/core/db/mongoose";
import { Scene } from "./models/Scene";
import type { StoryScene } from "@/core/ai/types";
import type { UpdateSceneInput } from "./schema";

/** Called once story generation completes — one Scene doc per story scene (ARCHITECTURE.md §5). */
export async function createScenesFromStory(userId: string, projectId: string, scenes: StoryScene[]) {
  await connectToDatabase();
  await Scene.deleteMany({ userId, projectId }); // re-generating the story replaces the scene plan
  if (scenes.length === 0) return [];
  return Scene.insertMany(
    scenes.map((s) => ({
      userId,
      projectId,
      index: s.index,
      visual: s.visual,
      dialogue: s.dialogue,
      camera: s.camera,
      emotion: s.emotion,
      status: "pending",
    })),
  );
}

export async function listScenes(userId: string, projectId: string) {
  await connectToDatabase();
  return Scene.find({ userId, projectId })
    .sort({ index: 1 })
    .populate("characterIds", "name sheetAssets")
    .populate("backgroundId", "name")
    .populate("imageAssetId")
    .populate("videoAssetId")
    .lean();
}

export async function getScene(userId: string, sceneId: string) {
  await connectToDatabase();
  return Scene.findOne({ _id: sceneId, userId });
}

export async function updateScene(userId: string, sceneId: string, input: UpdateSceneInput) {
  await connectToDatabase();
  return Scene.findOneAndUpdate({ _id: sceneId, userId }, { $set: input }, { new: true });
}

export async function duplicateScene(userId: string, sceneId: string) {
  await connectToDatabase();
  const original = await Scene.findOne({ _id: sceneId, userId }).lean();
  if (!original) return null;
  const maxIndex = await Scene.findOne({ userId, projectId: original.projectId }).sort({ index: -1 }).select("index").lean();
  const nextIndex = (maxIndex?.index ?? original.index) + 1;
  const { _id, createdAt, updatedAt, ...rest } = original as Record<string, unknown> & { _id: unknown };
  void _id;
  void createdAt;
  void updatedAt;
  return Scene.create({
    ...rest,
    index: nextIndex,
    imageAssetId: undefined,
    videoAssetId: undefined,
    voiceAssetId: undefined,
    videoTaskId: undefined,
    status: "pending",
  });
}

export async function deleteScene(userId: string, sceneId: string) {
  await connectToDatabase();
  await Scene.deleteOne({ _id: sceneId, userId });
}
