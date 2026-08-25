import { requireUserId } from "@/core/auth/session";
import { listProductionPlans, listAvailablePipelines } from "@/modules/production-plans/service";
import { HelpButton } from "@/components/shared/help-button";
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

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Create Video</h1>
        <HelpButton text="Describe the video in one line. The Production Director turns it into a plan — research, script, scenes, assets, voice, render, quality — which you review before anything is generated. Nothing is spent until you approve it." />
      </div>
      <CreateVideoPanel pipelines={listAvailablePipelines()} recentPlans={summaries} />
    </div>
  );
}
