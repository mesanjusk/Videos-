import { requireUserId } from "@/core/auth/session";
import { listProductionPlans, listAvailablePipelines } from "@/modules/production-plans/service";
import { CreateVideoPanel, type PlanSummary } from "./create-video-panel";

export const dynamic = "force-dynamic";

export default async function CreateVideoPage() {
  const userId = await requireUserId();
  const plans = await listProductionPlans(userId, 15);

  const summaries: PlanSummary[] = plans.map((doc) => {
    const plan = doc.plan as {
      objective?: string;
      language?: string;
      durationSeconds?: number;
      aspectRatio?: string;
      storyboard?: unknown[];
    };
    return {
      id: doc._id.toString(),
      request: doc.request,
      pipelineId: doc.pipelineId,
      status: doc.status ?? "draft",
      costPolicy: doc.costPolicy,
      notes: doc.notes ?? [],
      stages: doc.stages ?? [],
      objective: plan?.objective ?? doc.request,
      language: plan?.language ?? "en",
      durationSeconds: plan?.durationSeconds ?? 0,
      aspectRatio: plan?.aspectRatio ?? "9:16",
      sceneCount: Array.isArray(plan?.storyboard) ? plan.storyboard.length : 0,
      projectId: doc.projectId ? String(doc.projectId) : null,
      createdAt: doc.createdAt.toISOString(),
    };
  });

  return <CreateVideoPanel pipelines={listAvailablePipelines()} recentPlans={summaries} />;
}
