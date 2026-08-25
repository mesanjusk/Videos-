import type { TaskStep } from "@/core/browser/types";
import { FLOW_BASE_URL, FLOW_SELECTORS, FLOW_TIMEOUTS_MS } from "./selectors";

export interface BuildGoogleFlowTaskInput {
  promptText: string;
  referenceImageUrls?: string[];
  /** 5-8s per the PDF's Step 5 clamp — informational only; Flow's own UI controls actual duration. */
  durationSeconds?: number;
}

export interface BuildGoogleFlowTaskOutput {
  steps: TaskStep[];
  metadata: { promptText: string; referenceImageUrls: string[]; durationSeconds: number };
}

/**
 * Builds the generic `TaskStep[]` sequence for "open Flow, upload references, paste prompt,
 * generate, wait, download" — the same control flow as `core/automation/google-flow-driver.ts`
 * (Module 4), expressed as data instead of hardcoded Playwright calls, so it runs through the 7A
 * framework's ActionPipeline/RecoveryEngine/EventBus instead of a bespoke one-off path. See
 * `adapter.ts` for how each step gets interpreted — `filesFrom`/`textFrom` resolve against the run's
 * downloaded reference images and prompt text at execution time, since `TaskStep.params` must stay
 * JSON-serializable (`BrowserTaskRun.taskDefinition`) and a resumed run may execute against a fresh
 * temp dir on a different process than the one that started it.
 *
 * Callers outside this codebase (e.g. the Claude Code plugin's MCP server, which can't import TS
 * from `src/`) reproduce this same shape in plain JS — see `plugin/mcp-server/lib/google-flow-task.js`.
 * Keep the two in sync if this changes.
 */
export function buildGoogleFlowVideoTask(input: BuildGoogleFlowTaskInput): BuildGoogleFlowTaskOutput {
  const durationSeconds = Math.min(8, Math.max(5, input.durationSeconds ?? 8));
  const referenceImageUrls = input.referenceImageUrls ?? [];

  const steps: TaskStep[] = [
    { id: "navigate", action: "navigate", params: { url: FLOW_BASE_URL }, timeoutMs: FLOW_TIMEOUTS_MS.navigation },
    { id: "new-project", action: "click", params: { selector: FLOW_SELECTORS.newProjectButton } },
  ];

  if (referenceImageUrls.length > 0) {
    steps.push(
      { id: "open-upload", action: "click", params: { selector: FLOW_SELECTORS.referenceUploadButton } },
      { id: "upload-references", action: "upload_file", params: { selector: FLOW_SELECTORS.referenceFileInput, filesFrom: "referenceImages" } },
    );
  }

  steps.push(
    { id: "enter-prompt", action: "paste", params: { selector: FLOW_SELECTORS.promptInput, textFrom: "promptText" } },
    { id: "generate", action: "click", params: { selector: FLOW_SELECTORS.generateButton } },
    {
      id: "wait-render",
      action: "wait",
      params: { selector: FLOW_SELECTORS.resultVideo },
      timeoutMs: FLOW_TIMEOUTS_MS.render,
      retryable: false, // a render that never finishes shouldn't be retried from scratch — abort to manual instead
    },
    {
      id: "download",
      action: "download_file",
      params: { selector: FLOW_SELECTORS.downloadButton },
      timeoutMs: FLOW_TIMEOUTS_MS.download,
    },
  );

  return { steps, metadata: { promptText: input.promptText, referenceImageUrls, durationSeconds } };
}
