import { requireUserId } from "@/core/auth/session";
import { listProductionRuns } from "@/modules/production-runs/service";
import { listScenes } from "@/modules/scenes/service";
import { listJobsForProject } from "@/modules/jobs/service";
import { computePipelineStage } from "@/core/production-engine/compute-stage";
import type { ProjectStatus } from "@/modules/projects/constants";
import { HelpButton } from "@/components/shared/help-button";
import { PipelineMonitor, type PipelineRunItem } from "./pipeline-monitor";

export default async function ProductionPage() {
  const userId = await requireUserId();
  const runs = await listProductionRuns(userId);

  const items: PipelineRunItem[] = await Promise.all(
    runs.map(async (run) => {
      const project = run.projectId as unknown as {
        _id: string;
        title?: string;
        status?: ProjectStatus;
        completionPercent?: number;
        finalVideoAssetId?: unknown;
      } | null;
      const profile = run.profileId as unknown as { name?: string } | null;
      const projectId = project?._id?.toString();

      let stage = run.stage;
      if (stage !== "completed" && projectId) {
        const [scenes, jobs] = await Promise.all([listScenes(userId, projectId), listJobsForProject(userId, projectId)]);
        stage = computePipelineStage({
          projectStatus: project?.status ?? "draft",
          hasFinalVideo: !!project?.finalVideoAssetId,
          jobStatuses: jobs.map((j) => j.status),
          scenesTotal: scenes.length,
          scenesFailed: scenes.filter((s) => s.status === "failed").length,
        });
      }

      return {
        id: run._id.toString(),
        projectId: projectId ?? "",
        projectTitle: project?.title ?? "Untitled project",
        completionPercent: project?.completionPercent ?? 0,
        profileName: profile?.name ?? "Unknown profile",
        topic: run.topic,
        stage,
        startedAt: run.startedAt.toISOString(),
        completedAt: run.completedAt ? run.completedAt.toISOString() : null,
        executionTimeSeconds: run.executionTimeSeconds ?? null,
        retryCount: run.retryCount ?? 0,
        failedSceneCount: (run.failedSceneIds ?? []).length,
      };
    }),
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline Monitor</h1>
        <HelpButton text="Every production run started from a Production Profile, with its current stage derived live from the same project/scene/job data everywhere else already reads — nothing here is a second, separately-maintained status." />
      </div>
      <p className="text-sm text-muted-foreground">{items.length} production run{items.length === 1 ? "" : "s"}.</p>
      <PipelineMonitor runs={items} />
    </div>
  );
}
