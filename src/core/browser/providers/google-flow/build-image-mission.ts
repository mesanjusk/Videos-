import type { BrowserTask, TaskStep } from "@/core/browser/types";
import { FLOW_BASE_URL, FLOW_SELECTORS, FLOW_TIMEOUTS_MS } from "./selectors";

/**
 * One Google Flow mission that produces a single still image.
 *
 * Why images come from here at all: the Gemini free tier answers `limit: 0` for the configured
 * image model — an allowance never granted rather than one used up — so a key that has generated
 * nothing all week cannot make a picture. Flow is not metered that way for this account, and its
 * stills are the reference material its own video generation takes, which is exactly what a scene
 * needs them for.
 *
 * Deliberately one image per mission, not a batch. A character sheet is eight poses, and eight
 * prompts in one browser run means one flaky step loses all eight; separate missions lose one and
 * retry it. The queue is what makes that cheap.
 *
 * Every selector this leans on is an unverified guess against a site with no published DOM
 * contract — see `selectors.ts`. The `probe_page` step is therefore not decoration: when a run
 * fails, it is the difference between "a selector did not match" and knowing what was on the page
 * instead.
 */

export interface GoogleFlowImageAsset {
  url: string;
  fileName?: string;
  mimeType?: string;
}

export interface BuildGoogleFlowImageMissionInput {
  taskId: string;
  /** What to draw. Already composed by the prompt engine — nothing here rewrites it. */
  prompt: string;
  /** Character sheets and scene stills carry references so the same face survives across images. */
  referenceAssets?: GoogleFlowImageAsset[];
  aspectRatio?: "9:16" | "16:9" | "1:1" | "4:5";
  outputFileName?: string;
  projectId?: string;
  /** What this image is for. Carried through so the completion path can attach it — see flow-image.ts. */
  imageTarget?: Record<string, unknown>;
}

export function buildGoogleFlowImageMission(input: BuildGoogleFlowImageMissionInput): BrowserTask {
  const fileName = input.outputFileName ?? "google-flow-image.png";

  const steps: TaskStep[] = [
    {
      id: "open-flow",
      action: "navigate",
      stage: "opening_flow",
      params: { url: FLOW_BASE_URL },
      timeoutMs: FLOW_TIMEOUTS_MS.navigation,
    },
    {
      id: "new-project",
      action: "click",
      stage: "opening_flow",
      params: { selector: FLOW_SELECTORS.newProjectButton, optional: true },
      timeoutMs: FLOW_TIMEOUTS_MS.interaction,
      optional: true,
    },
    {
      // Records what is actually on the page before anything is clicked. On a site whose selectors
      // are guesses, a failed run with a probe is fixable; one without is a shrug.
      id: "probe-before-prompt",
      action: "probe_page",
      stage: "opening_flow",
      params: {},
      optional: true,
    },
    {
      id: "image-mode",
      action: "click",
      stage: "generating",
      params: { selector: FLOW_SELECTORS.imageModeButton, optional: true },
      timeoutMs: FLOW_TIMEOUTS_MS.interaction,
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
      // Accepts a clip as well as a still. If Flow answers an image request with video — a
      // different mode, a changed UI — the frame extractor downstream turns it into the image that
      // was asked for, rather than failing on a technicality about the file type.
      id: "wait-result",
      action: "wait",
      stage: "generating",
      params: { selector: `${FLOW_SELECTORS.resultImage}, ${FLOW_SELECTORS.resultVideo}` },
      timeoutMs: FLOW_TIMEOUTS_MS.render,
      retryable: false,
    },
    {
      // Reads the result out of the page rather than clicking Download.
      //
      // A Chrome download goes to the operator's own Downloads folder, which this application
      // cannot read, and the URL Chrome reports having fetched it from is either a `blob:` scoped
      // to a page that is about to close or an authenticated Google URL that answers nobody else.
      // So the mission used to finish with the image out of reach and the job waiting for it dying
      // one step later. Captured inside the page, where the session's cookies apply, the bytes come
      // back through POST /api/browser-automation/extension/tasks/:id/result and land in this
      // deployment's own storage.
      //
      // The selector is the result element itself, not a control: whatever the page is displaying
      // is what the prompt produced.
      id: "capture-image",
      action: "capture_result",
      stage: "exporting",
      params: {
        selector: `${FLOW_SELECTORS.resultImage}, ${FLOW_SELECTORS.resultVideo}`,
        fileName,
      },
      timeoutMs: FLOW_TIMEOUTS_MS.download,
      retryable: false,
    },
  );

  return {
    id: input.taskId,
    providerId: "google-flow",
    steps,
    metadata: {
      missionType: "google-flow-image",
      executionTarget: "extension",
      outputSystem: "google-flow",
      outputFileName: fileName,
      aspectRatio: input.aspectRatio ?? "9:16",
      projectId: input.projectId,
      imageTarget: input.imageTarget,
      referenceCount: input.referenceAssets?.length ?? 0,
      aiFallbackPolicy: "on-structured-action-failure-only",
    },
  };
}
