import type { Job as BullJob } from "bullmq";
import { withJobLifecycle, type BullJobData, type ProcessorResult } from "./helpers";
import { connectToDatabase } from "@/core/db/mongoose";
import { directProduction } from "@/core/production/director";
import { ProductionPlanModel } from "@/modules/production-plans/models/ProductionPlan";
import type { ProductionStage } from "@/core/production/types";

/**
 * Runs the Production Director for one request and stores the resulting plan.
 *
 * A queue job rather than an inline call because planning is a model call — several seconds, and
 * subject to the same provider routing, quota rotation and retry behaviour as every other
 * generation. It reaches no Playwright and no FFmpeg, so it lives in the shared registry and runs
 * on the Vercel tick as well as on the worker.
 *
 * The job produces a plan and stops. Nothing is generated and nothing is spent beyond the planning
 * call itself until a human approves it.
 */
export async function processProductionPlanJob(bullJob: BullJob<BullJobData>): Promise<ProcessorResult> {
  return withJobLifecycle(bullJob, async (jobDoc) => {
    await connectToDatabase();
    const payload = (jobDoc.payload ?? {}) as {
      request?: string;
      pipelineId?: string;
      language?: string;
      durationSeconds?: number;
      aspectRatio?: "9:16" | "16:9" | "1:1" | "4:5";
      costPolicy?: string;
      skipStages?: ProductionStage[];
      correlationId?: string;
    };
    if (!payload.request) throw new Error("production_plan job is missing payload.request");

    const result = await directProduction({
      request: payload.request,
      pipelineId: payload.pipelineId,
      language: payload.language,
      durationSeconds: payload.durationSeconds,
      aspectRatio: payload.aspectRatio,
      costPolicy: payload.costPolicy,
      skipStages: payload.skipStages,
    });

    const doc = await ProductionPlanModel.create({
      userId: jobDoc.userId,
      request: payload.request,
      pipelineId: result.pipeline.id,
      plan: result.plan,
      stages: result.stages,
      notes: result.notes,
      costPolicy: result.costPolicy,
      plannedByProvider: result.providerId,
      correlationId: payload.correlationId,
      status: "draft",
    });

    // Recorded on the job too, so the observability fields answer "which provider served this and
    // under what policy" without joining to the plan.
    jobDoc.set("provider", result.providerId);
    jobDoc.set("costPolicy", result.costPolicy);
    jobDoc.set("correlationId", payload.correlationId);

    return {
      status: "completed",
      planId: doc._id.toString(),
      pipelineId: result.pipeline.id,
      stages: result.stages,
      notes: result.notes,
      sceneCount: result.plan.storyboard.length,
    };
  });
}
