import type { HydratedDocument } from "mongoose";
import type { JobDoc } from "@/modules/jobs/models/Job";
import type { GeneratedImage } from "@/core/ai/types";
import { buildGoogleFlowImageMission } from "@/core/browser/providers/google-flow/build-image-mission";
import { enqueueExtensionBrowserTask } from "@/modules/browser-automation/extension-service";
import { BrowserTaskRun } from "@/modules/browser-automation/models/BrowserTaskRun";
import { imageFromMission } from "./flow-image";

/**
 * Generating images through Google Flow, from a job that cannot sit and wait for them.
 *
 * A Flow mission takes minutes: a browser opens, a prompt is typed, a model renders. A serverless
 * tick has forty-five seconds. So the step does not block — it enqueues the missions, records which
 * run belongs to which image, and parks. When the extension finishes a mission, the job is enqueued
 * again and this time finds the results waiting.
 *
 * The park is `manual_pending`, a status this queue already has for exactly this shape of work (the
 * Flow video hand-off). It is not a failure, and it must not be retried by BullMQ — a retry would
 * start a second set of missions for images already being drawn.
 *
 * ## Why a batch
 *
 * A character sheet is ten poses. Ten prompts in one browser run means one flaky step loses all
 * ten; ten missions lose one and retry it. So requests are keyed and tracked individually, and the
 * job resumes only when every one of its images has landed. Single-image steps are the same
 * mechanism with one entry, which is why there is no second code path for them.
 */

export class FlowMissionPendingError extends Error {
  constructor(readonly runIds: string[]) {
    super(
      `Waiting on ${runIds.length} Google Flow mission${runIds.length === 1 ? "" : "s"}. ` +
        "The browser extension runs these; this step continues when they finish.",
    );
    this.name = "FlowMissionPendingError";
  }
}

/** Raised when a mission finished badly. Distinct from pending so the job fails rather than parking forever. */
export class FlowMissionFailedError extends Error {
  constructor(runId: string, detail?: string) {
    super(`A Google Flow mission failed${detail ? `: ${detail}` : "."} (run ${runId})`);
    this.name = "FlowMissionFailedError";
  }
}

export interface FlowImageRequest {
  /** Identifies this image within the job — a pose name, or just "image" when there is one. */
  key: string;
  prompt: string;
  referenceUrls?: string[];
}

export interface FlowImageOptions {
  projectId?: string;
  aspectRatio?: "9:16" | "16:9" | "1:1" | "4:5";
  /** Recorded on the mission so the completion hook knows which job to wake. */
  imageTarget?: Record<string, unknown>;
}

type RunMap = Record<string, string>;

function runMapOf(jobDoc: HydratedDocument<JobDoc>): RunMap {
  const payload = (jobDoc.payload ?? {}) as { flowRunIds?: RunMap };
  return payload.flowRunIds ?? {};
}

/**
 * The images for this job, or a park.
 *
 * Enqueues a mission for every request that does not have one yet — so a job resumed after a
 * partial failure asks again only for what is missing, rather than redrawing what already landed.
 */
export async function resolveFlowImages(
  jobDoc: HydratedDocument<JobDoc>,
  requests: FlowImageRequest[],
  options: FlowImageOptions = {},
): Promise<Record<string, GeneratedImage>> {
  const existing = runMapOf(jobDoc);
  const missing = requests.filter((r) => !existing[r.key]);

  if (missing.length > 0) {
    const started: RunMap = { ...existing };
    for (const request of missing) {
      const mission = buildGoogleFlowImageMission({
        taskId: "assigned-on-enqueue",
        prompt: request.prompt,
        referenceAssets: (request.referenceUrls ?? []).map((url) => ({ url })),
        aspectRatio: options.aspectRatio,
        projectId: options.projectId,
        imageTarget: { ...options.imageTarget, jobId: jobDoc._id.toString(), key: request.key },
      });

      const { runId } = await enqueueExtensionBrowserTask(jobDoc.userId, {
        providerId: mission.providerId,
        projectId: options.projectId,
        steps: mission.steps,
        metadata: mission.metadata,
      });
      started[request.key] = runId;
    }

    // `flowRunIdList` is the same ids as a flat array, purely so a query can find this job by one
    // of its missions — Mongo cannot match the values of an arbitrary-keyed object without an
    // aggregation, and the wake path needs that lookup to survive a retry (see flow-image-wake.ts).
    jobDoc.set("payload", { ...(jobDoc.payload ?? {}), flowRunIds: started, flowRunIdList: Object.values(started) });
    await jobDoc.save();
    throw new FlowMissionPendingError(Object.values(started));
  }

  const runIds = requests.map((r) => existing[r.key]!);
  const runs = await BrowserTaskRun.find({ _id: { $in: runIds }, userId: jobDoc.userId })
    .select("_id stage error downloads")
    .lean();
  const byId = new Map(runs.map((run) => [run._id.toString(), run]));

  const failed = runs.find((run) => run.stage === "failed");
  if (failed) throw new FlowMissionFailedError(failed._id.toString(), failed.error ?? undefined);

  const unfinished = runIds.filter((id) => byId.get(id)?.stage !== "completed");
  if (unfinished.length > 0) throw new FlowMissionPendingError(unfinished);

  const entries = await Promise.all(
    requests.map(async (request) => {
      const run = byId.get(existing[request.key]!);
      const image = await imageFromMission({ downloads: run?.downloads as { path: string; url?: string }[] });
      return [request.key, image] as const;
    }),
  );
  return Object.fromEntries(entries);
}
