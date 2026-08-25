import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { Job as BullJob } from "bullmq";
import { withJobLifecycle, type BullJobData, type ProcessorResult } from "./helpers";
import { connectToDatabase } from "@/core/db/mongoose";
import { BrowserSession as BrowserSessionModel } from "@/modules/browser-automation/models/BrowserSession";
import { decryptSecret } from "@/core/security/encryption";
import { BrowserSession } from "@/core/browser/session";
import { WorkflowEngine } from "@/core/automation/engine";
import type { EngineHooks, StepCompleteEvent } from "@/core/automation/engine/types";
import type { WorkflowDefinition } from "@/core/browser/shared";
import {
  AutomationTask,
  Execution,
  ExecutionStep,
  HumanIntervention,
  createSecretResolver,
  getWorkflowDefinition,
  writeAuditLog,
} from "@/modules/automation/service";
import { getStorageProvider } from "@/core/storage";
import { StoredFile } from "@/modules/automation/models/StoredFile";
import { enqueueJob } from "@/modules/jobs/service";

const WORKER_ID = process.env.WORKER_ID ?? `worker-${process.pid}`;

/**
 * Runs one `AutomationTask` through the workflow engine — the merged home of Browser Automation
 * OS's `apps/worker/src/processor.ts`.
 *
 * Registered only in `core/queue/worker-only-processors.ts`: it reaches Playwright through
 * `core/browser/`, the same isolation rule every other browser-backed job type follows.
 *
 * Three behaviours worth knowing about, all inherited deliberately:
 *
 *  - **Resume, not restart.** A task that stopped at a HUMAN_APPROVAL node comes back with
 *    `status: WAITING_FOR_HUMAN` and a `currentStepId`; the engine starts from that node with the
 *    variables it had, rather than replaying the run from the top.
 *  - **The queue does not retry this job** (`attempts: 1`, see core/queue/queues.ts). The engine
 *    retries per node with a transient/permanent classification; a whole-job retry would re-run
 *    steps that already succeeded.
 *  - **Secrets never enter the run record.** `{{secret:name}}` resolves through
 *    `createSecretResolver`, straight into the Playwright call — the plaintext is never written to
 *    `task.variables`, an ExecutionStep, or a screenshot caption.
 */
export async function processAutomationWorkflowJob(bullJob: BullJob<BullJobData>): Promise<ProcessorResult> {
  return withJobLifecycle(bullJob, async (jobDoc) => {
    await connectToDatabase();
    const taskId = (jobDoc.payload as { taskId?: string } | undefined)?.taskId;
    if (!taskId) throw new Error("automation_workflow job is missing payload.taskId");

    const task = await AutomationTask.findOne({ _id: taskId, userId: jobDoc.userId });
    if (!task) throw new Error(`AutomationTask ${taskId} not found`);
    if (task.status === "CANCELLED" || task.cancelRequested) {
      return { status: "completed", cancelled: true };
    }

    const definition = (await getWorkflowDefinition(jobDoc.userId, String(task.workflowVersionId))) as WorkflowDefinition | null;
    if (!definition) throw new Error("The workflow version this task pinned no longer exists");

    const isResume = task.status === "WAITING_FOR_HUMAN" && !!task.currentStepId;
    const startNodeId = isResume ? (task.currentStepId as string) : definition.startNodeId;
    const initialVariables = isResume
      ? ((task.variables as Record<string, unknown>) ?? {})
      : { input: task.input ?? {} };

    task.status = isResume ? "RUNNING" : "STARTING";
    task.workerId = WORKER_ID;
    if (!task.startedAt) task.startedAt = new Date();
    await task.save();

    const attempt = (await Execution.countDocuments({ taskId: task._id })) + 1;
    const execution = await Execution.create({
      userId: jobDoc.userId,
      taskId: task._id,
      attempt,
      workerId: WORKER_ID,
    });

    const downloadDir = path.join(process.env.LOCAL_STORAGE_DIR ?? "./storage/local", "downloads", String(task._id));
    await mkdir(downloadDir, { recursive: true });

    const storageState = await loadStorageState(jobDoc.userId, task.browserSessionId ? String(task.browserSessionId) : undefined);
    const session = await BrowserSession.launch({ storageState });

    const hooks: EngineHooks = {
      log: (message) => console.log(`[automation ${task._id}] ${message}`),
      shouldCancel: async () => {
        const fresh = await AutomationTask.findById(task._id).select("cancelRequested").lean();
        return Boolean(fresh?.cancelRequested);
      },
      onStepStart: async ({ stepId }) => {
        task.currentStepId = stepId;
        await task.save();
      },
      onStepComplete: async (event) => {
        await recordStep(jobDoc.userId, String(execution._id), String(task._id), event);
      },
      requestHumanApproval: async ({ stepId, message }) => {
        // Always "pending": approving from inside the worker would defeat the point. The run
        // pauses, a HumanIntervention row appears in the dashboard, and resuming re-enqueues.
        await HumanIntervention.create({
          userId: jobDoc.userId,
          taskId: task._id,
          stepId,
          reason: "APPROVAL",
          message,
          status: "pending",
        });
        return "pending";
      },
      deliverWebhook: async (url, payload) => {
        await enqueueJob({
          userId: jobDoc.userId,
          type: "automation_webhook",
          payload: { url, body: { ...payload, taskId: String(task._id) } },
        });
      },
    };

    try {
      const engine = new WorkflowEngine({
        definition,
        session,
        hooks,
        options: {
          maxAiActions: Number(process.env.MAX_AI_ACTIONS ?? 100),
          allowedAiDomains: (process.env.AI_ALLOWED_DOMAINS ?? "").split(",").map((d) => d.trim()).filter(Boolean),
          resolveSecret: createSecretResolver(jobDoc.userId, String(task._id)),
        },
        downloadDir,
      });

      const result = await engine.run(startNodeId, initialVariables);

      task.variables = result.variables;
      task.currentStepId = result.lastNodeId;
      task.status =
        result.status === "completed"
          ? "COMPLETED"
          : result.status === "paused"
            ? "WAITING_FOR_HUMAN"
            : result.status === "cancelled"
              ? "CANCELLED"
              : "FAILED";
      task.error = result.error;
      task.completedAt = result.status === "paused" ? undefined : new Date();
      task.durationMs = task.startedAt ? Date.now() - task.startedAt.getTime() : undefined;
      await task.save();

      execution.status = result.status === "completed" ? "completed" : result.status === "paused" ? "paused" : "failed";
      execution.completedAt = new Date();
      await execution.save();

      await writeAuditLog({
        userId: jobDoc.userId,
        actorType: "system",
        action: `automation.${result.status}`,
        resourceType: "AutomationTask",
        resourceId: String(task._id),
        metadata: { lastNodeId: result.lastNodeId, attempt },
      });

      if (task.callbackUrl) {
        await enqueueJob({
          userId: jobDoc.userId,
          type: "automation_webhook",
          payload: {
            url: task.callbackUrl,
            body: { event: `automation.${result.status}`, taskId: String(task._id), status: task.status, variables: result.variables },
          },
        });
      }

      // A paused run is not a failed one — it is waiting on a person, and the job should close
      // cleanly so the queue does not treat it as an error.
      if (result.status === "failed") throw new Error(result.error?.message ?? "Workflow failed");
      return { status: result.status === "paused" ? "manual_pending" : "completed", taskStatus: task.status, attempt };
    } finally {
      await session.close().catch(() => {});
    }
  });
}

async function loadStorageState(userId: string, sessionId?: string): Promise<unknown> {
  if (!sessionId) return undefined;
  // storageStateEnc is `select: false` — explicitly requested here, and only here plus
  // MongoSessionStore, both of which run in the worker.
  const doc = await BrowserSessionModel.findOne({ _id: sessionId, userId }).select("+storageStateEnc").lean();
  if (!doc?.storageStateEnc) return undefined;
  BrowserSessionModel.updateOne({ _id: sessionId }, { lastUsedAt: new Date() }).catch(() => {});
  return JSON.parse(decryptSecret(doc.storageStateEnc)) as unknown;
}

/**
 * Persists one executed node. The screenshot, if any, goes through the storage abstraction rather
 * than being inlined into Mongo — a full-page PNG per step would blow past the document size limit
 * on any run of length.
 */
async function recordStep(
  userId: string,
  executionId: string,
  taskId: string,
  event: StepCompleteEvent,
): Promise<void> {
  let screenshotFileId: unknown;
  if (event.screenshotBuffer) {
    try {
      const storage = getStorageProvider();
      const asset = await storage.upload(event.screenshotBuffer, "image", {
        folder: `automation/${taskId}`,
        publicId: `${event.stepId}-${Date.now()}`,
      });
      const file = await StoredFile.create({
        userId,
        name: `${event.stepId}.png`,
        mimeType: "image/png",
        bytes: asset.bytes,
        provider: asset.provider,
        url: asset.url,
        storageKey: asset.storageKey,
        kind: "screenshot",
        taskId,
      });
      screenshotFileId = file._id;
    } catch (err) {
      // A screenshot is evidence, not the work. Losing one must not fail the step that produced it.
      console.error(`[automation ${taskId}] could not store screenshot for step ${event.stepId}:`, err);
    }
  }

  await ExecutionStep.create({
    userId,
    executionId,
    taskId,
    stepId: event.stepId,
    action: event.nodeType,
    name: event.nodeName,
    selectorStrategyUsed: event.selectorStrategyUsed,
    status: event.status,
    output: event.output as Record<string, unknown> | undefined,
    error: event.error,
    durationMs: event.duration,
    screenshotFileId,
  });
}
