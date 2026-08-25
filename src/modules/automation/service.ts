import { connectToDatabase } from "@/core/db/mongoose";
import { encryptSecret, decryptSecret, redactSecrets } from "@/core/security/encryption";
import { enqueueJob } from "@/modules/jobs/service";
import { validateWorkflowDefinition, workflowDefinitionSchema, type WorkflowDefinition } from "@/core/browser/shared";
import { Workflow, WorkflowVersion } from "./models/Workflow";
import { Automation } from "./models/Automation";
import { AutomationTask, Execution, ExecutionStep } from "./models/AutomationTask";
import { Schedule } from "./models/Schedule";
import { Webhook } from "./models/Webhook";
import { HumanIntervention } from "./models/HumanIntervention";
import { Credential } from "./models/Credential";
import { AuditLog } from "./models/AuditLog";

// ── Audit ────────────────────────────────────────────────────────────────

/**
 * The single writer for the audit trail. Metadata is redacted against any secret values the caller
 * passes so a well-meaning `metadata: { value }` can never persist a credential in plaintext.
 */
export async function writeAuditLog(input: {
  userId: string;
  actorType: "user" | "api_token" | "system";
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  secretsToRedact?: (string | undefined)[];
  ip?: string;
}): Promise<void> {
  await connectToDatabase();
  const metadata = input.metadata
    ? (JSON.parse(redactSecrets(JSON.stringify(input.metadata), input.secretsToRedact ?? [])) as Record<string, unknown>)
    : undefined;
  await AuditLog.create({
    userId: input.userId,
    actorType: input.actorType,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    metadata,
    ip: input.ip,
  }).catch((err) => {
    // An audit write must never take down the operation it is recording. Losing a line is bad;
    // failing a user's action because the log write failed is worse.
    console.error("[audit] failed to write audit log:", err);
  });
}

export async function listAuditLogs(userId: string, limit = 100) {
  await connectToDatabase();
  return AuditLog.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
}

// ── Workflows ────────────────────────────────────────────────────────────

export async function listWorkflows(userId: string) {
  await connectToDatabase();
  return Workflow.find({ userId }).sort({ updatedAt: -1 }).lean();
}

export async function getWorkflow(userId: string, workflowId: string) {
  await connectToDatabase();
  const workflow = await Workflow.findOne({ _id: workflowId, userId }).lean();
  if (!workflow) return null;
  const versions = await WorkflowVersion.find({ workflowId, userId }).sort({ version: -1 }).limit(20).lean();
  return { workflow, versions };
}

export async function createWorkflow(userId: string, input: { name: string; description?: string }) {
  await connectToDatabase();
  return Workflow.create({ userId, name: input.name, description: input.description });
}

/**
 * Saves a new immutable version. The definition is validated twice on purpose: zod checks the
 * shape, then `validateWorkflowDefinition` checks the graph is internally consistent (every `next`,
 * branch and loop body points at a node that exists). A graph that fails the second check parses
 * fine and then dead-ends at run time, which is a much worse place to discover it.
 */
export async function saveWorkflowVersion(
  userId: string,
  workflowId: string,
  definition: unknown,
  opts: { notes?: string; publish?: boolean } = {},
) {
  await connectToDatabase();
  const workflow = await Workflow.findOne({ _id: workflowId, userId });
  if (!workflow) throw new Error("Workflow not found");

  const parsed = workflowDefinitionSchema.safeParse(definition);
  if (!parsed.success) throw new Error(`Invalid workflow definition: ${parsed.error.issues.map((i) => i.message).join("; ")}`);

  const graphErrors = validateWorkflowDefinition(parsed.data);
  if (graphErrors.length > 0) throw new Error(`Invalid workflow graph: ${graphErrors.join("; ")}`);

  const version = (workflow.currentVersion ?? 0) + 1;
  const doc = await WorkflowVersion.create({
    userId,
    workflowId,
    version,
    definition: parsed.data,
    notes: opts.notes,
    publishedAt: opts.publish ? new Date() : undefined,
  });

  workflow.currentVersion = version;
  if (opts.publish) {
    workflow.publishedVersionId = doc._id;
    workflow.status = "published";
  }
  await workflow.save();
  return doc;
}

export async function getWorkflowDefinition(userId: string, versionId: string): Promise<WorkflowDefinition | null> {
  await connectToDatabase();
  const version = await WorkflowVersion.findOne({ _id: versionId, userId }).lean();
  return (version?.definition as WorkflowDefinition | undefined) ?? null;
}

// ── Automations ──────────────────────────────────────────────────────────

export async function listAutomations(userId: string) {
  await connectToDatabase();
  return Automation.find({ userId }).sort({ updatedAt: -1 }).populate("workflowId", "name status").lean();
}

export async function createAutomation(
  userId: string,
  input: { name: string; workflowId: string; description?: string; browserSessionId?: string; defaultInput?: Record<string, unknown>; callbackUrl?: string },
) {
  await connectToDatabase();
  const workflow = await Workflow.findOne({ _id: input.workflowId, userId }).lean();
  if (!workflow) throw new Error("Workflow not found");
  return Automation.create({ userId, ...input });
}

/**
 * Creates the AutomationTask and the `automation_workflow` Job that will run it.
 *
 * Mirrors `modules/browser-automation/service.ts#enqueueBrowserTask`: the domain record and the
 * queue record are created together and cross-linked, so the dashboard can show queue status and
 * execution history from one lookup. The workflow version is pinned here, not read at run time.
 */
export async function runAutomation(
  userId: string,
  automationId: string,
  input: Record<string, unknown> = {},
  source: "api" | "dashboard" | "schedule" | "pipeline" = "dashboard",
) {
  await connectToDatabase();
  const automation = await Automation.findOne({ _id: automationId, userId });
  if (!automation) throw new Error("Automation not found");
  if (!automation.enabled) throw new Error("This automation is disabled");

  const workflow = await Workflow.findOne({ _id: automation.workflowId, userId }).lean();
  if (!workflow?.publishedVersionId) {
    throw new Error("This automation's workflow has no published version — publish one before running it.");
  }

  const task = await AutomationTask.create({
    userId,
    automationId: automation._id,
    workflowId: workflow._id,
    workflowVersionId: workflow.publishedVersionId,
    status: "QUEUED",
    input: { ...(automation.defaultInput ?? {}), ...input },
    browserSessionId: automation.browserSessionId,
    callbackUrl: automation.callbackUrl,
    source,
  });

  const job = await enqueueJob({
    userId,
    type: "automation_workflow",
    payload: { taskId: task._id.toString() },
  });

  task.jobId = job._id;
  await task.save();

  automation.lastRunAt = new Date();
  await automation.save();

  return { task, jobId: job._id.toString() };
}

export async function listAutomationTasks(userId: string, limit = 50) {
  await connectToDatabase();
  return AutomationTask.find({ userId }).sort({ updatedAt: -1 }).limit(limit).populate("automationId", "name").lean();
}

export async function getAutomationTask(userId: string, taskId: string) {
  await connectToDatabase();
  const task = await AutomationTask.findOne({ _id: taskId, userId }).lean();
  if (!task) return null;
  const [steps, intervention] = await Promise.all([
    ExecutionStep.find({ taskId, userId }).sort({ timestamp: 1 }).limit(500).lean(),
    HumanIntervention.findOne({ taskId, userId, status: "pending" }).lean(),
  ]);
  return { task, steps, intervention };
}

/** Cooperative cancel — the worker polls this flag, the same mechanism BrowserTaskRun uses. */
export async function requestCancelAutomationTask(userId: string, taskId: string) {
  await connectToDatabase();
  return AutomationTask.findOneAndUpdate(
    { _id: taskId, userId, status: { $in: ["QUEUED", "STARTING", "RUNNING", "WAITING_FOR_HUMAN", "RETRYING"] } },
    { cancelRequested: true },
    { new: true },
  );
}

// ── Credentials ──────────────────────────────────────────────────────────

export async function listCredentials(userId: string) {
  await connectToDatabase();
  // valueEnc is select:false, so this can never accidentally serialise a secret.
  return Credential.find({ userId }).sort({ name: 1 }).lean();
}

export async function upsertCredential(userId: string, input: { name: string; value: string; type?: string; metadata?: Record<string, unknown> }) {
  await connectToDatabase();
  const doc = await Credential.findOneAndUpdate(
    { userId, name: input.name },
    { valueEnc: encryptSecret(input.value), type: input.type ?? "password", metadata: input.metadata },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await writeAuditLog({
    userId,
    actorType: "user",
    action: "credential.upsert",
    resourceType: "Credential",
    resourceId: doc._id.toString(),
    metadata: { name: input.name },
    secretsToRedact: [input.value],
  });
  return { _id: doc._id, name: doc.name, type: doc.type };
}

export async function deleteCredential(userId: string, id: string) {
  await connectToDatabase();
  await Credential.deleteOne({ _id: id, userId });
  await writeAuditLog({ userId, actorType: "user", action: "credential.delete", resourceType: "Credential", resourceId: id });
}

/**
 * Builds the `{{secret:name}}` resolver handed to the workflow engine.
 *
 * Scoped to one user — a workflow can only ever reach that user's own credentials, however the
 * token is spelled. Each resolution is audited, because "which run read which credential, when" is
 * exactly the question an operator needs answerable after the fact.
 */
export function createSecretResolver(userId: string, taskId: string) {
  return async (name: string): Promise<string | undefined> => {
    await connectToDatabase();
    const doc = await Credential.findOne({ userId, name }).select("+valueEnc").lean();
    if (!doc?.valueEnc) return undefined;
    Credential.updateOne({ _id: doc._id }, { lastUsedAt: new Date() }).catch(() => {});
    await writeAuditLog({
      userId,
      actorType: "system",
      action: "credential.read",
      resourceType: "Credential",
      resourceId: doc._id.toString(),
      metadata: { name, taskId },
    });
    return decryptSecret(doc.valueEnc);
  };
}

// ── Schedules & webhooks ─────────────────────────────────────────────────

export async function listSchedules(userId: string) {
  await connectToDatabase();
  return Schedule.find({ userId }).sort({ nextRunAt: 1 }).populate("automationId", "name").lean();
}

export async function listWebhooks(userId: string) {
  await connectToDatabase();
  return Webhook.find({ userId }).sort({ createdAt: -1 }).lean();
}

export { Workflow, WorkflowVersion, Automation, AutomationTask, Execution, ExecutionStep, Schedule, Webhook, HumanIntervention, Credential, AuditLog };
