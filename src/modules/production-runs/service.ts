import { connectToDatabase } from "@/core/db/mongoose";
import { ProductionRun } from "./models/ProductionRun";

export interface CreateProductionRunInput {
  userId: string;
  projectId: string;
  profileId: string;
  profileVersion: number;
  topic: string;
  notes?: string;
  promptTemplateVersionsUsed: Record<string, string>;
  characterVersionsUsed: Record<string, number>;
  providerUsed: Record<string, string>;
}

export async function createProductionRun(input: CreateProductionRunInput) {
  await connectToDatabase();
  return ProductionRun.create({
    userId: input.userId,
    projectId: input.projectId,
    profileId: input.profileId,
    profileVersion: input.profileVersion,
    topic: input.topic,
    notes: input.notes,
    promptTemplateVersionsUsed: input.promptTemplateVersionsUsed,
    characterVersionsUsed: input.characterVersionsUsed,
    providerUsed: input.providerUsed,
    startedAt: new Date(),
    stage: "generating",
  });
}

export async function listProductionRuns(userId: string, limit = 50) {
  await connectToDatabase();
  return ProductionRun.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("projectId", "title status completionPercent finalVideoAssetId")
    .populate("profileId", "name")
    .lean();
}

export async function getProductionRun(userId: string, id: string) {
  await connectToDatabase();
  return ProductionRun.findOne({ _id: id, userId }).populate("projectId", "title status").populate("profileId", "name").lean();
}

/** The one and only in-code place a run's terminal state is written — called from
 * core/queue/orchestrator.ts#onRenderCompleted once a profile-driven project's render finishes.
 * Everything before "completed" is derived at read time (core/production-engine/compute-stage.ts),
 * not written here, so there's no second source of truth to keep in sync mid-run. */
export async function completeProductionRun(
  userId: string,
  projectId: string,
  input: { retryCount: number; failedSceneIds: string[]; generatedAssetIds: string[] },
) {
  await connectToDatabase();
  const run = await ProductionRun.findOne({ userId, projectId, stage: { $ne: "completed" } }).sort({ createdAt: -1 });
  if (!run) return null;
  const completedAt = new Date();
  run.completedAt = completedAt;
  run.executionTimeSeconds = Math.round((completedAt.getTime() - run.startedAt.getTime()) / 1000);
  run.retryCount = input.retryCount;
  run.failedSceneIds = input.failedSceneIds as unknown as typeof run.failedSceneIds;
  run.generatedAssetIds = input.generatedAssetIds as unknown as typeof run.generatedAssetIds;
  run.stage = "completed";
  await run.save();
  return run;
}
