import type { ProjectStatus } from "@/modules/projects/constants";
import type { JobStatus } from "@/modules/jobs/models/Job";
import type { ProductionRunStage } from "@/modules/production-runs/models/ProductionRun";

export interface PipelineStageInput {
  projectStatus: ProjectStatus;
  hasFinalVideo: boolean;
  jobStatuses: JobStatus[]; // every Job for this project, most relevant ones matter most
  scenesTotal: number;
  scenesFailed: number;
}

/**
 * Derives a run's current pipeline stage from real Project/Job/Scene state — the same
 * derive-don't-duplicate precedent as lib/workflow-steps.ts#computeStepStatuses. Nothing writes a
 * competing "current stage" field that could drift; this is the only place that decides it, and it
 * decides it fresh every time it's called. `ProductionRun.stage` in the DB only ever holds
 * "planning" (at creation) or "completed" (written once, see
 * modules/production-runs/service.ts#completeProductionRun) — everything in between is this
 * function's job.
 */
export function computePipelineStage(input: PipelineStageInput): ProductionRunStage {
  if (input.hasFinalVideo) return "completed";
  if (input.scenesFailed > 0 && input.scenesFailed === input.scenesTotal) return "failed";

  const hasRetrying = input.jobStatuses.includes("retrying");
  if (hasRetrying) return "retry";

  const hasFailed = input.jobStatuses.includes("failed");
  if (hasFailed && !input.jobStatuses.some((s) => s === "queued" || s === "running" || s === "retrying")) return "failed";

  switch (input.projectStatus) {
    case "draft":
      return "planning";
    case "story":
    case "characters":
    case "backgrounds":
      return "ready";
    case "scenes":
      return "generating";
    case "rendering":
      return input.jobStatuses.includes("manual_pending") ? "quality_check" : "rendering";
    case "done":
      return "completed";
    default:
      return "planning";
  }
}
