import { connectToDatabase } from "@/core/db/mongoose";
import { Scene } from "./models/Scene";
import type { StoryScene } from "@/core/ai/types";
import type { UpdateSceneInput } from "./schema";
import { staleFlagsForUpdate } from "./dependencies";

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
    .populate("voiceAssetId")
    .populate("lipSyncAssetId")
    .lean();
}

export async function getScene(userId: string, sceneId: string) {
  await connectToDatabase();
  return Scene.findOne({ _id: sceneId, userId });
}

export async function updateScene(userId: string, sceneId: string, input: UpdateSceneInput) {
  await connectToDatabase();
  const existing = await Scene.findOne({ _id: sceneId, userId }).select(
    "imageAssetId videoAssetId voiceAssetId lipSyncAssetId",
  );
  if (!existing) return null;

  const staleFlags = staleFlagsForUpdate(input);
  // Only flag an asset stale if it was already generated — nothing to invalidate otherwise.
  if (!existing.imageAssetId) delete staleFlags.imageStale;
  if (!existing.videoAssetId) delete staleFlags.videoStale;
  if (!existing.voiceAssetId) delete staleFlags.voiceStale;
  if (!existing.lipSyncAssetId) delete staleFlags.lipSyncStale;

  return Scene.findOneAndUpdate({ _id: sceneId, userId }, { $set: { ...input, ...staleFlags } }, { new: true });
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
    lipSyncAssetId: undefined,
    videoTaskId: undefined,
    lipSyncTaskId: undefined,
    status: "pending",
  });
}

export async function deleteScene(userId: string, sceneId: string) {
  await connectToDatabase();
  await Scene.deleteOne({ _id: sceneId, userId });
}

/**
 * Applies a new scene order (drag-and-drop reorder in the Scene Manager). `sceneIds` must be every
 * scene in the project, in the desired order. Writing final indexes in one pass would collide with
 * the `{projectId, index}` unique index whenever any two scenes swap places, so this stages through
 * negative placeholder indexes (guaranteed not to collide with any existing or final positive index)
 * before writing the real 0-based positions.
 */
export async function reorderScenes(userId: string, projectId: string, sceneIds: string[]): Promise<boolean> {
  await connectToDatabase();
  const owned = await Scene.find({ userId, projectId }).select("_id").lean();
  const ownedIds = new Set(owned.map((s) => s._id.toString()));
  if (sceneIds.length !== owned.length || sceneIds.some((id) => !ownedIds.has(id))) return false;

  await Scene.bulkWrite(
    sceneIds.map((id, position) => ({
      updateOne: { filter: { _id: id, userId }, update: { $set: { index: -(position + 1) } } },
    })),
  );
  await Scene.bulkWrite(
    sceneIds.map((id, position) => ({
      updateOne: { filter: { _id: id, userId }, update: { $set: { index: position } } },
    })),
  );
  return true;
}
