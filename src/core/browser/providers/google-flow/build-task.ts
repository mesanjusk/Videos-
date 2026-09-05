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
 * generate, wait, download" — expressed as data instead of hardcoded Playwright calls, so it runs
 * through the framework's ActionPipeline/RecoveryEngine/EventBus. See `adapter.ts` for how each step
 * gets interpreted — `filesFrom`/`textFrom` resolve against the run's downloaded reference images
 * and prompt text at execution time, since `TaskStep.params` must stay JSON-serializable
 * (`BrowserTaskRun.taskDefinition`) and a resumed run may execute against a fresh temp dir on a
 * different process than the one that started it.
 *
 * ## The sequence is state-driven, not selector-driven
 *
 * Every step used to assume the screen it expected was already on display, and reported a selector
 * timeout when it wasn't. On a product with no DOM contract that reads as "the download button was
 * not visible after two minutes" whether the real problem was a signed-out session, a
 * human-verification challenge, or a render that genuinely takes longer than expected — three
 * situations with three different answers.
 *
 * So each phase now ends at a `wait_for_state` against the adapter's own reading of the page
 * (`./state.ts`), which fails immediately and by name on the screens a run can never proceed from,
 * and keeps waiting on the ones that just take time. The clicks between them are `optional`: the
 * state check is what decides whether the run is where it needs to be, so "click New project" may
 * legitimately miss on a Flow that opened straight into a workspace.
 *
 * `probe_page` runs once before the prompt is entered. It stamps a ref on every visible control and
 * records what was really there — which is both what a later step can address precisely and, when a
 * run does fail, the only record of the page as it actually was.
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
    // The first thing that runs is a question, not an action: is this session actually signed in
    // and looking at Flow? A signed-out session fails here, in two seconds, saying so — instead of
    // 90 seconds later as "New project button not found".
    {
      id: "await-flow",
      action: "wait_for_state",
      params: { states: ["LANDING", "WORKSPACE", "PROMPT_READY", "CLIP_READY"] },
      timeoutMs: FLOW_TIMEOUTS_MS.navigation,
    },
    { id: "shot-landing", action: "screenshot", params: { name: "flow_landing" } },
    { id: "new-project", action: "click", params: { selector: FLOW_SELECTORS.newProjectButton }, optional: true },
    {
      id: "await-prompt",
      action: "wait_for_state",
      params: { states: ["PROMPT_READY", "WORKSPACE"] },
      timeoutMs: FLOW_TIMEOUTS_MS.interaction * 4,
    },
    // Everything after this addresses a page we have actually read.
    { id: "probe", action: "probe_page", params: {} },
  ];

  if (referenceImageUrls.length > 0) {
    steps.push(
      { id: "open-upload", action: "click", params: { selector: FLOW_SELECTORS.referenceUploadButton }, optional: true },
      {
        id: "upload-references",
        action: "upload_file",
        params: { selector: FLOW_SELECTORS.referenceFileInput, filesFrom: "referenceImages" },
      },
    );
  }

  steps.push(
    { id: "enter-prompt", action: "paste", params: { selector: FLOW_SELECTORS.promptInput, textFrom: "promptText" } },
    // The one click the whole run depends on. `expectChange` makes a Generate that lands on a
    // disabled button fail here and get retried, rather than succeeding silently and leaving the
    // run to wait out its full five-minute render timeout for a clip nobody asked for.
    { id: "generate", action: "click", params: { selector: FLOW_SELECTORS.generateButton }, expectChange: true },
    { id: "shot-submitted", action: "screenshot", params: { name: "flow_prompt_submitted" } },
    {
      id: "await-clip",
      action: "wait_for_state",
      params: { state: "CLIP_READY", pollMs: 5000 },
      timeoutMs: FLOW_TIMEOUTS_MS.render,
      retryable: false, // a render that never finishes shouldn't be retried from scratch — abort to manual instead
    },
    { id: "shot-clip", action: "screenshot", params: { name: "flow_clip_complete" } },
    {
      id: "download",
      action: "download_file",
      params: { selector: FLOW_SELECTORS.downloadButton },
      timeoutMs: FLOW_TIMEOUTS_MS.download,
    },
  );

  return { steps, metadata: { promptText: input.promptText, referenceImageUrls, durationSeconds } };
}
