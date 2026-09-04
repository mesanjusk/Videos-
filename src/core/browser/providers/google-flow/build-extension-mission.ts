import type { BrowserTask, TaskStep } from "@/core/browser/types";
import { FLOW_BASE_URL, FLOW_SELECTORS, FLOW_TIMEOUTS_MS } from "./selectors";

export interface GoogleFlowMissionAsset {
  url: string;
  fileName?: string;
  mimeType?: string;
}

export interface GoogleFlowMissionScene {
  id: string;
  prompt: string;
  referenceAssets?: GoogleFlowMissionAsset[];
}

export interface BuildGoogleFlowExtensionMissionInput {
  taskId: string;
  scenes: GoogleFlowMissionScene[];
  sharedAssets?: GoogleFlowMissionAsset[];
  outputFileName?: string;
  aspectRatio?: "9:16" | "16:9" | "1:1";
  language?: string;
  projectId?: string;
}

/**
 * Builds one deterministic Google Flow mission for the Chrome extension. Gemini/production logic
 * belongs upstream; this function only translates already-structured scenes into browser actions.
 */
export function buildGoogleFlowExtensionMission(input: BuildGoogleFlowExtensionMissionInput): BrowserTask {
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
      params: { selector: FLOW_SELECTORS.newProjectButton },
      timeoutMs: FLOW_TIMEOUTS_MS.interaction,
    },
  ];

  const sharedAssets = input.sharedAssets ?? [];
  if (sharedAssets.length) {
    steps.push({
      id: "upload-shared-assets",
      action: "upload_url",
      stage: "uploading_assets",
      params: { selector: FLOW_SELECTORS.referenceFileInput, files: sharedAssets },
      timeoutMs: FLOW_TIMEOUTS_MS.interaction,
    });
  }

  input.scenes.forEach((scene, index) => {
    if (scene.referenceAssets?.length) {
      steps.push({
        id: `scene-${index + 1}-upload-assets`,
        action: "upload_url",
        stage: "uploading_assets",
        params: { selector: FLOW_SELECTORS.referenceFileInput, files: scene.referenceAssets },
        timeoutMs: FLOW_TIMEOUTS_MS.interaction,
      });
    }

    steps.push(
      {
        id: `scene-${index + 1}-prompt`,
        action: "paste",
        stage: "generating",
        params: { selector: FLOW_SELECTORS.promptInput, text: scene.prompt },
      },
      {
        id: `scene-${index + 1}-generate`,
        action: "click",
        stage: "generating",
        params: { selector: FLOW_SELECTORS.generateButton },
      },
      {
        id: `scene-${index + 1}-wait`,
        action: "wait",
        stage: "generating",
        params: { selector: FLOW_SELECTORS.resultVideo },
        timeoutMs: FLOW_TIMEOUTS_MS.render,
        retryable: false,
      },
      {
        id: `scene-${index + 1}-timeline`,
        action: "click",
        stage: "combining",
        params: { selector: FLOW_SELECTORS.addToTimelineButton },
        timeoutMs: FLOW_TIMEOUTS_MS.interaction,
      },
    );
  });

  steps.push(
    {
      id: "combine-scenes",
      action: "click",
      stage: "combining",
      params: { selector: FLOW_SELECTORS.combineButton, optional: true },
      timeoutMs: FLOW_TIMEOUTS_MS.combine,
    },
    {
      id: "wait-combined-preview",
      action: "wait",
      stage: "combining",
      params: { selector: FLOW_SELECTORS.combinedPreview },
      timeoutMs: FLOW_TIMEOUTS_MS.combine,
    },
    {
      id: "export",
      action: "click",
      stage: "exporting",
      params: { selector: FLOW_SELECTORS.exportButton },
      timeoutMs: FLOW_TIMEOUTS_MS.interaction,
    },
    {
      id: "export-mp4",
      action: "download_file",
      stage: "exporting",
      params: {
        selector: `${FLOW_SELECTORS.exportMp4Button}, ${FLOW_SELECTORS.downloadButton}`,
        fileName: input.outputFileName ?? "google-flow-final.mp4",
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
      missionType: "google-flow-final-video",
      executionTarget: "extension",
      outputSystem: "google-flow",
      ffmpegRole: "fallback-postprocess-only",
      outputFileName: input.outputFileName ?? "google-flow-final.mp4",
      aspectRatio: input.aspectRatio ?? "9:16",
      language: input.language ?? "Hindi",
      projectId: input.projectId,
      sceneCount: input.scenes.length,
      aiFallbackPolicy: "on-structured-action-failure-only",
    },
  };
}
