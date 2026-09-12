import { Types } from "mongoose";
import { connectToDatabase } from "@/core/db/mongoose";
import type { BrowserTask } from "@/core/browser/types";
import type { ExecuteBrowserTaskInput, ExtensionTaskUpdateInput } from "./schema";
import { BrowserTaskRun } from "./models/BrowserTaskRun";
import { getStorageProvider, type AssetKind } from "@/core/storage";

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

/** Which storage bucket a captured result belongs in, from what the browser said it is. */
export function assetKindForMimeType(mimeType: string | undefined): AssetKind {
  if (!mimeType) return "raw";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "raw";
}

export interface ExtensionResultInput {
  workerId: string;
  fileName: string;
  mimeType?: string;
  data: Buffer;
}

/**
 * Stores the bytes a mission produced and records where they landed.
 *
 * This is the return trip the extension never had. A mission would finish, report the URL Chrome
 * had downloaded from, and the server would then fail to fetch it — a `blob:` belongs to a page
 * that has closed, and an authenticated Google URL does not answer a request carrying none of the
 * operator's cookies. The file itself was in a Downloads folder on someone's laptop. So the image
 * existed, the run said "completed", and the job waiting for it died at the last step.
 *
 * The bytes now come to us, through the deployment's own storage provider, and `downloads[].url`
 * becomes a URL this application can actually read — which is all `core/production/flow-image.ts`
 * ever wanted from it.
 *
 * Appended rather than replaced: a mission may capture more than one result (a sheet of poses in a
 * single run), and each arrives as its own request.
 */
export async function recordExtensionResult(runId: string, input: ExtensionResultInput) {
  await connectToDatabase();
  // Claim check first: storing bytes for a run this worker does not hold would let any valid token
  // write into anyone's run, and it is one query to refuse.
  const run = await BrowserTaskRun.findOne({ _id: runId, executionTarget: "extension", claimedBy: input.workerId })
    .select("_id userId projectId")
    .lean();
  if (!run) return null;

  const kind = assetKindForMimeType(input.mimeType);
  const stored = await getStorageProvider().upload(input.data, kind, {
    folder: `flow-missions/${runId}`,
    fileName: input.fileName,
  });

  const download = { path: input.fileName, url: stored.url, bytes: stored.bytes };
  await BrowserTaskRun.updateOne({ _id: runId }, { $push: { downloads: download }, $set: { lastHeartbeatAt: new Date() } });
  return download;
}

/**
 * Fails missions whose extension stopped reporting, and says which ones.
 *
 * This existed and was never called from anywhere — so a browser closed mid-mission left the run in
 * a non-terminal stage forever, and the image job parked on it waited on something that was never
 * coming back. Retrying did not help either: the retry inherits the same run ids, finds them
 * unfinished, and parks again.
 *
 * Returns the runs it failed rather than an update count, because failing them is only half the
 * job — each one may have a parked job that now needs to hear about it. The callers wake those.
 */
export async function failStaleExtensionTasks(staleBefore: Date) {
  await connectToDatabase();
  const stale = await BrowserTaskRun.find({
    executionTarget: "extension",
    stage: { $nin: ["pending", "completed", "failed"] },
    lastHeartbeatAt: { $lt: staleBefore },
  })
    .select("_id userId taskDefinition")
    .lean();
  if (stale.length === 0) return [];

  await BrowserTaskRun.updateMany(
    { _id: { $in: stale.map((run) => run._id) } },
    { $set: { stage: "failed", state: "failed", error: "Extension heartbeat expired", completedAt: new Date() } },
  );
  console.warn(`[extension] failed ${stale.length} mission(s) whose extension stopped reporting`);
  return stale;
}
