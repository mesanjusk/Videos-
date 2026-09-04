import { Types } from "mongoose";
import { connectToDatabase } from "@/core/db/mongoose";
import type { BrowserTask } from "@/core/browser/types";
import type { ExecuteBrowserTaskInput, ExtensionTaskUpdateInput } from "./schema";
import { BrowserTaskRun } from "./models/BrowserTaskRun";

/**
 * Creates a browser task that is intentionally NOT enqueued into BullMQ. This prevents the
 * existing Playwright browser_task processor from racing the Chrome extension for the same job.
 */
export async function enqueueExtensionBrowserTask(userId: string, input: ExecuteBrowserTaskInput) {
  await connectToDatabase();
  const id = new Types.ObjectId();
  const task: BrowserTask = {
    id: id.toString(),
    providerId: input.providerId,
    sessionId: input.sessionId,
    steps: input.steps,
    metadata: input.metadata,
  };

  await BrowserTaskRun.create({
    _id: id,
    userId,
    projectId: input.projectId,
    providerId: input.providerId,
    taskDefinition: task,
    executionTarget: "extension",
    state: "idle",
    stage: "pending",
    currentStepIndex: 0,
    totalSteps: input.steps.length,
  });

  return { runId: id.toString(), executionTarget: "extension" as const, stage: "pending" as const };
}

/** Atomically claims the oldest pending extension task. */
export async function claimNextExtensionTask(workerId: string, providerId = "google-flow") {
  await connectToDatabase();
  const now = new Date();
  return BrowserTaskRun.findOneAndUpdate(
    { executionTarget: "extension", providerId, stage: "pending", cancelRequested: { $ne: true } },
    {
      $set: {
        stage: "claimed",
        state: "executing",
        claimedBy: workerId,
        claimedAt: now,
        lastHeartbeatAt: now,
        startedAt: now,
      },
    },
    { new: true, sort: { createdAt: 1 } },
  ).lean();
}

export async function updateExtensionTask(runId: string, input: ExtensionTaskUpdateInput) {
  await connectToDatabase();
  const terminal = input.stage === "completed" || input.stage === "failed";
  const update: Record<string, unknown> = {
    stage: input.stage,
    lastHeartbeatAt: new Date(),
  };
  if (typeof input.currentStepIndex === "number") update.currentStepIndex = input.currentStepIndex;
  if (input.error !== undefined) update.error = input.error;
  if (input.downloads !== undefined) update.downloads = input.downloads;
  if (input.resultMetadata !== undefined) update.resultMetadata = input.resultMetadata;
  if (terminal) {
    update.state = input.stage;
    update.completedAt = new Date();
  } else {
    update.state = "executing";
  }

  return BrowserTaskRun.findOneAndUpdate(
    { _id: runId, executionTarget: "extension", claimedBy: input.workerId },
    { $set: update },
    { new: true },
  ).lean();
}

export async function failStaleExtensionTasks(staleBefore: Date) {
  await connectToDatabase();
  return BrowserTaskRun.updateMany(
    {
      executionTarget: "extension",
      stage: { $nin: ["pending", "completed", "failed"] },
      lastHeartbeatAt: { $lt: staleBefore },
    },
    { $set: { stage: "failed", state: "failed", error: "Extension heartbeat expired", completedAt: new Date() } },
  );
}
