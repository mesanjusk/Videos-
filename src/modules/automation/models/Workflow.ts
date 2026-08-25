import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { WORKFLOW_STATUSES } from "../constants";

/**
 * A named, versioned browser-automation workflow. Ported from Browser Automation OS with one
 * mandatory change: **`userId`**.
 *
 * Project B was effectively single-tenant — its models carried `createdBy` for attribution but
 * nothing filtered on it. This application scopes every collection to the signed-in user and
 * filters on it in every query. Porting these models without that field would have let any user
 * read and run any other user's workflows and credentials; see docs/MERGE-AUDIT.md §29.4, which
 * flagged it as the highest-severity risk in the merge.
 */
const workflowSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: { type: String },
    status: { type: String, enum: WORKFLOW_STATUSES, default: "draft", index: true },
    currentVersion: { type: Number, default: 0 },
    publishedVersionId: { type: Schema.Types.ObjectId, ref: "WorkflowVersion" },
  },
  { timestamps: true },
);

workflowSchema.index({ userId: 1, updatedAt: -1 });
workflowSchema.index({ userId: 1, name: 1 }, { unique: true });

export type WorkflowDoc = InferSchemaType<typeof workflowSchema>;
export const Workflow: Model<WorkflowDoc> =
  (models.Workflow as Model<WorkflowDoc>) ?? model<WorkflowDoc>("Workflow", workflowSchema);

/**
 * An immutable snapshot of a workflow's node graph. A running task pins the exact version it
 * started with, so editing a workflow never changes what an in-flight or historical run did.
 */
const workflowVersionSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    workflowId: { type: Schema.Types.ObjectId, ref: "Workflow", required: true, index: true },
    version: { type: Number, required: true },
    /** A `WorkflowDefinition` (core/browser/shared/schemas/workflow.ts), validated on write. */
    definition: { type: Schema.Types.Mixed, required: true },
    notes: { type: String },
    publishedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

workflowVersionSchema.index({ workflowId: 1, version: -1 }, { unique: true });

export type WorkflowVersionDoc = InferSchemaType<typeof workflowVersionSchema>;
export const WorkflowVersion: Model<WorkflowVersionDoc> =
  (models.WorkflowVersion as Model<WorkflowVersionDoc>) ??
  model<WorkflowVersionDoc>("WorkflowVersion", workflowVersionSchema);
