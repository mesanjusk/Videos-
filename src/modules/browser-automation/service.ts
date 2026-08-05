import { connectToDatabase } from "@/core/db/mongoose";
import { encryptSecret, decryptSecret } from "@/core/auth/encryption";
import { enqueueJob, cancelJob } from "@/modules/jobs/service";
import { BrowserSession } from "./models/BrowserSession";
import { BrowserTaskRun } from "./models/BrowserTaskRun";
import { BrowserExecutionLog } from "./models/BrowserExecutionLog";
import { BrowserProviderConfig } from "./models/BrowserProviderConfig";
import type { CreateBrowserSessionInput, ExecuteBrowserTaskInput, UpsertBrowserProviderConfigInput } from "./schema";
import type { SessionStore } from "@/core/browser-automation/session-manager";
import type { StateStore } from "@/core/browser-automation/state-engine";
import type { TaskStore } from "@/core/browser-automation/task-engine";
import type { ExecutionMonitor } from "@/core/browser-automation/execution-monitor";
import type { BrowserTask, ExecutionState } from "@/core/browser-automation/types";

// ---- Sessions ----------------------------------------------------------

export async function listBrowserSessions(userId: string) {
  await connectToDatabase();
  return BrowserSession.find({ userId }).select("-storageStateEnc").sort({ updatedAt: -1 }).lean();
}

export async function createBrowserSession(userId: string, input: CreateBrowserSessionInput) {
  await connectToDatabase();
  return BrowserSession.findOneAndUpdate(
    { userId, providerId: input.providerId, label: input.label },
    { storageStateEnc: encryptSecret(input.storageStateJson), connectedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).select("-storageStateEnc");
}

export async function deleteBrowserSession(userId: string, id: string) {
  await connectToDatabase();
  await BrowserSession.deleteOne({ _id: id, userId });
}

/** Persistence-backed `SessionStore` — the only place `core/browser-automation/` is wired to Mongo,
 * kept entirely outside the framework core (docs/BROWSER-AUTOMATION-FRAMEWORK-PLAN.md §6). Scoped to
 * one user's sessions so a task can never restore another user's storageState by guessing an id. */
export class MongoSessionStore implements SessionStore {
  constructor(private readonly userId: string) {}

  async load(sessionId: string): Promise<string | null> {
    await connectToDatabase();
    const doc = await BrowserSession.findOne({ _id: sessionId, userId: this.userId }).lean();
    if (!doc) return null;
    BrowserSession.updateOne({ _id: sessionId }, { lastUsedAt: new Date() }).catch(() => {});
    return decryptSecret(doc.storageStateEnc);
  }

  async save(sessionId: string, storageStateJson: string): Promise<void> {
    await connectToDatabase();
    await BrowserSession.updateOne(
      { _id: sessionId, userId: this.userId },
      { storageStateEnc: encryptSecret(storageStateJson), lastUsedAt: new Date() },
    );
  }
}

// ---- Task runs -----------------------------------------------------------

export async function listBrowserTaskRuns(userId: string, limit = 50) {
  await connectToDatabase();
  return BrowserTaskRun.find({ userId }).sort({ updatedAt: -1 }).limit(limit).lean();
}

export async function getBrowserTaskRun(userId: string, runId: string) {
  await connectToDatabase();
  return BrowserTaskRun.findOne({ _id: runId, userId }).lean();
}

export async function listExecutionLogs(runId: string, limit = 200) {
  await connectToDatabase();
  return BrowserExecutionLog.find({ runId }).sort({ timestamp: -1 }).limit(limit).lean();
}

/**
 * Creates the Mongo `Job` (via the existing Scene Queue machinery, unmodified) alongside a
 * `BrowserTaskRun` sharing the same id as the job, so `TaskEngine`'s `runId` (= `BrowserTask.id`)
 * is one lookup away from both its queue status and its execution history. See
 * docs/BROWSER-AUTOMATION-FRAMEWORK-PLAN.md §7 — "Queue → Task → Browser Framework → Provider Adapter".
 */
export async function enqueueBrowserTask(userId: string, input: ExecuteBrowserTaskInput) {
  await connectToDatabase();
  const jobDoc = await enqueueJob({ userId, projectId: input.projectId, type: "browser_task", payload: {} });
  const runId = jobDoc._id.toString();

  const task: BrowserTask = {
    id: runId,
    providerId: input.providerId,
    sessionId: input.sessionId,
    steps: input.steps,
    metadata: input.metadata,
  };

  await BrowserTaskRun.create({
    _id: jobDoc._id,
    userId,
    projectId: input.projectId,
    jobId: jobDoc._id,
    providerId: input.providerId,
    taskDefinition: task,
    state: "idle",
    currentStepIndex: 0,
    totalSteps: input.steps.length,
  });

  return { runId, jobId: runId };
}

/** Mirrors the existing `cancelJob` limitation ("only jobs still waiting in the queue"): a run
 * already executing needs the worker's TaskEngine to notice `cancelRequested` cooperatively (the
 * `browser_task` processor polls this field — see `core/queue/processors/browser-task.processor.ts`). */
export async function requestCancelBrowserTask(userId: string, runId: string) {
  await connectToDatabase();
  const run = await BrowserTaskRun.findOne({ _id: runId, userId });
  if (!run) return null;

  run.set("cancelRequested", true);
  await run.save();

  if (run.jobId) {
    await cancelJob(userId, run.jobId.toString()).catch(() => {
      // Not "queued" anymore (already running) — the cancelRequested flag above is the fallback.
    });
  }
  return run;
}

export async function requestPauseBrowserTask(userId: string, runId: string) {
  await connectToDatabase();
  const run = await BrowserTaskRun.findOne({ _id: runId, userId });
  if (!run) return null;
  run.set("pauseRequested", true);
  await run.save();
  return run;
}

/** Clears the pause flag and, if the run isn't actively owned by a live worker anymore (state
 * "waiting" left over from a pause or a process restart), enqueues a fresh `browser_task` Job whose
 * payload tells the processor to call `TaskEngine.resume(runId)` instead of `execute()`. */
export async function resumeBrowserTask(userId: string, runId: string) {
  await connectToDatabase();
  const run = await BrowserTaskRun.findOne({ _id: runId, userId });
  if (!run) return null;
  run.set("pauseRequested", false);
  await run.save();

  if (run.state === "waiting") {
    await enqueueJob({ userId, projectId: run.projectId?.toString(), type: "browser_task", payload: { resumeRunId: runId } });
  }
  return run;
}

/** Re-runs a failed/cancelled task from scratch as a brand-new run, reusing its `taskDefinition`. */
export async function restartBrowserTask(userId: string, runId: string) {
  await connectToDatabase();
  const run = await BrowserTaskRun.findOne({ _id: runId, userId }).lean();
  if (!run) return null;

  const task = run.taskDefinition as BrowserTask;
  return enqueueBrowserTask(userId, {
    providerId: task.providerId,
    sessionId: task.sessionId,
    steps: task.steps,
    metadata: task.metadata,
    projectId: run.projectId?.toString(),
  });
}

/** Persistence-backed `StateStore` — see docs/BROWSER-AUTOMATION-FRAMEWORK-PLAN.md §6. */
export class MongoStateStore implements StateStore {
  async load(runId: string): Promise<{ state: ExecutionState; currentStepIndex: number } | null> {
    await connectToDatabase();
    const doc = await BrowserTaskRun.findById(runId).select("state currentStepIndex").lean();
    if (!doc) return null;
    return { state: doc.state as ExecutionState, currentStepIndex: doc.currentStepIndex ?? 0 };
  }

  async save(runId: string, state: ExecutionState, currentStepIndex: number): Promise<void> {
    await connectToDatabase();
    const update: Record<string, unknown> = { state, currentStepIndex };
    if (state === "launching") update.startedAt = new Date();
    if (state === "completed" || state === "failed" || state === "cancelled") update.completedAt = new Date();
    await BrowserTaskRun.updateOne({ _id: runId }, update);
  }
}

/** Persistence-backed `TaskStore` — the only way `TaskEngine.resume(runId)` can reload a task
 * definition after the process that started it exited. */
export class MongoTaskStore implements TaskStore {
  async save(task: BrowserTask): Promise<void> {
    await connectToDatabase();
    await BrowserTaskRun.updateOne({ _id: task.id }, { taskDefinition: task, totalSteps: task.steps.length });
  }

  async load(runId: string): Promise<BrowserTask | null> {
    await connectToDatabase();
    const doc = await BrowserTaskRun.findById(runId).select("taskDefinition").lean();
    return (doc?.taskDefinition as BrowserTask) ?? null;
  }
}

/** Wraps an in-memory `ExecutionMonitor` (live snapshot for the dashboard) so every `record()` call
 * also lands in `BrowserExecutionLog` (history that survives past the run, per §6). */
export class PersistingExecutionMonitor implements ExecutionMonitor {
  constructor(private readonly inner: ExecutionMonitor) {}

  snapshot(runId: string) {
    return this.inner.snapshot(runId);
  }

  async record(runId: string, entry: { level: "info" | "warn" | "error"; message: string; data?: unknown }): Promise<void> {
    await this.inner.record(runId, entry);
    await connectToDatabase();
    await BrowserExecutionLog.create({ runId, level: entry.level, message: entry.message, data: entry.data });
  }
}

// ---- Provider configs ----------------------------------------------------

export async function listBrowserProviderConfigs(userId: string) {
  await connectToDatabase();
  return BrowserProviderConfig.find({ userId }).sort({ providerId: 1 }).lean();
}

export async function upsertBrowserProviderConfig(userId: string, input: UpsertBrowserProviderConfigInput) {
  await connectToDatabase();
  return BrowserProviderConfig.findOneAndUpdate(
    { userId, providerId: input.providerId },
    { ...input },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export async function deleteBrowserProviderConfig(userId: string, providerId: string) {
  await connectToDatabase();
  await BrowserProviderConfig.deleteOne({ userId, providerId });
}
