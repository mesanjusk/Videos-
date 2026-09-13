import type { BrowserTask, TaskStep } from "@/core/browser/types";
import { FLOW_BASE_URL, FLOW_SELECTORS, FLOW_TIMEOUTS_MS } from "./selectors";

/**
 * One Google Flow mission that produces a single scene's clip, executed by the Chrome extension.
 *
 * ## Why this exists next to the Playwright route
 *
 * `scene_video_auto` drives Flow with Playwright on a worker. That route needs a Chromium the host
 * may not have, and a CPU budget it may not have either — on a small instance a browser and a video
 * encoder compete with whatever else that process is serving. This one runs in the operator's own
 * browser, on hardware already paid for, where they are already signed into Flow. The server only
 * ever handles the finished file.
 *
 * Neither replaces the other. A deployment with a worker and a stored session keeps using it; one
 * with an extension connected and no worker can now make videos at all, which it could not before.
 *
 * ## What differs from the image mission
 *
 * Almost nothing, and that is the point — the same site, the same composer, the same submit. Three
 * things:
 *
 *  - no image-mode switch. Flow generates video by default; clicking into stills and back is a step
 *    that can only go wrong.
 *  - the wait is longer. A still is seconds; a clip is minutes, and `FLOW_TIMEOUTS_MS.render` is the
 *    budget the rest of this provider already uses for one.
 *  - the result waited for is a `<video>`. `capture_result` then reads it out of the page, which is
 *    the only place a `blob:` or a cookie-gated asset can be read at all — see build-image-mission.
 */

export interface GoogleFlowVideoAsset {
  url: string;
  fileName?: string;
  mimeType?: string;
}

export interface BuildGoogleFlowVideoMissionInput {
  taskId: string;
  /** Already composed by the prompt engine — the same text the manual hand-off would have shown. */
  prompt: string;
  /** The scene's cast, so the same faces survive from the stills into the clip. */
  referenceAssets?: GoogleFlowVideoAsset[];
  aspectRatio?: "9:16" | "16:9" | "1:1" | "4:5";
  outputFileName?: string;
  projectId?: string;
  /** What this clip is for. Carried through so the completion path can attach it. */
  videoTarget?: Record<string, unknown>;
}

export function buildGoogleFlowVideoMission(input: BuildGoogleFlowVideoMissionInput): BrowserTask {
  const fileName = input.outputFileName ?? "google-flow-clip.mp4";

  const steps: TaskStep[] = [
    {
      id: "open-flow",
      action: "navigate",
      stage: "opening_flow",
      params: { url: FLOW_BASE_URL },
      timeoutMs: FLOW_TIMEOUTS_MS.navigation,
    },
    {
      // Optional because Flow may open straight into a workspace, and that is not an error — the
      // prompt box is what decides whether the run is where it needs to be.
      id: "new-project",
      action: "click",
      stage: "opening_flow",
      params: { selector: FLOW_SELECTORS.newProjectButton, optional: true },
      timeoutMs: FLOW_TIMEOUTS_MS.interaction,
      optional: true,
    },
    {
      // On a site whose selectors are guesses, a failed run with a probe is fixable; one without is
      // a shrug.
      id: "probe-before-prompt",
      action: "probe_page",
      stage: "opening_flow",
      params: {},
      optional: true,
    },
  ];

  if (input.referenceAssets?.length) {
    steps.push({
      id: "upload-references",
      action: "upload_url",
      stage: "uploading_assets",
      params: { selector: FLOW_SELECTORS.referenceFileInput, files: input.referenceAssets },
      timeoutMs: FLOW_TIMEOUTS_MS.interaction,
    });
  }

  steps.push(
    {
      id: "enter-prompt",
      action: "paste",
      stage: "generating",
      params: { selector: FLOW_SELECTORS.promptInput, text: input.prompt },
      timeoutMs: FLOW_TIMEOUTS_MS.interaction,
    },
    {
      id: "generate",
      action: "click",
      stage: "generating",
      params: { selector: FLOW_SELECTORS.generateButton },
      timeoutMs: FLOW_TIMEOUTS_MS.interaction,
    },
    {
      // Minutes, not seconds. Not retryable: a render that never finishes should not be started
      // again from scratch — it should end, and let the job say so.
      id: "wait-clip",
      action: "wait",
      stage: "generating",
      params: { selector: FLOW_SELECTORS.resultVideo },
      timeoutMs: FLOW_TIMEOUTS_MS.render,
      retryable: false,
    },
    {
      id: "capture-clip",
      action: "capture_result",
      stage: "exporting",
      params: { selector: FLOW_SELECTORS.resultVideo, fileName },
      timeoutMs: FLOW_TIMEOUTS_MS.download,
      retryable: false,
    },
  );

  return {
    id: input.taskId,
    providerId: "google-flow",
    steps,
    metadata: {
      missionType: "google-flow-video",
      executionTarget: "extension",
      outputSystem: "google-flow",
      outputFileName: fileName,
      aspectRatio: input.aspectRatio ?? "9:16",
      projectId: input.projectId,
      // Named `imageTarget` despite carrying a clip: it is the key the completion path reads to
      // find the job waiting on this mission (core/production/flow-image-wake.ts), and one name for
      // "what this mission is for" is better than two that mean the same thing.
      imageTarget: input.videoTarget,
      referenceCount: input.referenceAssets?.length ?? 0,
      aiFallbackPolicy: "on-structured-action-failure-only",
    },
  };
}
