import { randomUUID } from "node:crypto";
import { connectToDatabase } from "@/core/db/mongoose";
import { enqueueJob } from "@/modules/jobs/service";
import { Project } from "@/modules/projects/models/Project";
import { listPipelines } from "@/core/production/pipelines";
import type { ProductionPlan, ProductionStage } from "@/core/production/types";
import { ProductionPlanModel } from "./models/ProductionPlan";

export interface CreatePlanRequestInput {
  request: string;
  pipelineId?: string;
  language?: string;
  durationSeconds?: number;
  aspectRatio?: "9:16" | "16:9" | "1:1" | "4:5";
  costPolicy?: string;
  skipStages?: ProductionStage[];
}

/**
 * Kicks off planning. Returns immediately with a job to poll — planning is a model call and can
 * take several seconds, which is too long to hold an HTTP request open for.
 */
export async function requestProductionPlan(userId: string, input: CreatePlanRequestInput) {
  await connectToDatabase();
  const job = await enqueueJob({
    userId,
    type: "production_plan",
    payload: { ...input, correlationId: randomUUID() },
  });
  return { jobId: job._id.toString() };
}

export async function listProductionPlans(userId: string, limit = 30) {
  await connectToDatabase();
  return ProductionPlanModel.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
}

export async function getProductionPlan(userId: string, planId: string) {
  await connectToDatabase();
  return ProductionPlanModel.findOne({ _id: planId, userId }).lean();
}

/**
 * Approves a plan and starts the production.
 *
 * Creates the Project the pipeline works against, pre-filled from the plan, and enqueues the story
 * job — from there the existing orchestrator (core/queue/orchestrator.ts) chains scene image →
 * video → voice → lipsync → render → thumbnail exactly as it does for any other full-mode project.
 * The Director's job ends here; it does not reimplement the pipeline it just planned.
 */
export async function approveProductionPlan(userId: string, planId: string) {
  await connectToDatabase();
  const doc = await ProductionPlanModel.findOne({ _id: planId, userId });
  if (!doc) throw new Error("Plan not found");
  if (doc.status !== "draft") throw new Error(`This plan is already ${doc.status} — approving it again would run it twice.`);

  const plan = doc.plan as ProductionPlan;

  const project = await Project.create({
    userId,
    title: plan.objective.slice(0, 120),
    language: plan.language,
    durationSeconds: plan.durationSeconds,
    style: "Pixar",
    storyInputMode: "idea",
    premise: doc.request,
    status: "draft",
    completionPercent: 5,
    // The Director planned every stage, so the orchestrator's auto-chain is what should carry it —
    // that is the same machinery a Production Profile run uses, not a second execution path.
    pipelineMode: "full",
    sceneCount: Math.max(1, plan.storyboard.length || Math.round(plan.durationSeconds / 8)),
  });

  const job = await enqueueJob({
    userId,
    projectId: project._id.toString(),
    type: "story",
    payload: { fromPlanId: planId, correlationId: doc.correlationId },
  });

  doc.status = "running";
  doc.projectId = project._id;
  doc.approvedAt = new Date();
  await doc.save();

  return { planId, projectId: project._id.toString(), jobId: job._id.toString() };
}

export async function cancelProductionPlan(userId: string, planId: string) {
  await connectToDatabase();
  return ProductionPlanModel.findOneAndUpdate(
    { _id: planId, userId, status: { $in: ["draft", "running"] } },
    { status: "cancelled" },
    { new: true },
  );
}

export function listAvailablePipelines() {
  return listPipelines().map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    stages: p.stages,
    defaults: p.defaults,
  }));
}
