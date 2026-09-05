// Mirrors src/core/browser/providers/google-flow/build-task.ts and
// src/core/browser/providers/google-flow/selectors.ts — duplicated here in plain JS because this
// plugin runs as a standalone Node process outside the app's TypeScript build and can't import from
// src/. Keep the two in sync if either changes; the app's version is the one actually exercised by
// GoogleFlowProviderAdapter, this one just needs to produce the same step shape.
//
// Same honest caveat as the app's selectors.ts: labs.google/flow has no public API or documented
// DOM contract. These selectors are best-effort placeholders — an operator with real Flow access
// should recalibrate both copies against `npx playwright codegen labs.google/flow`.

export const FLOW_SELECTORS = {
  newProjectButton: '[data-testid="new-project-button"], button:has-text("New project")',
  promptInput: '[data-testid="prompt-input"], textarea[placeholder*="Describe" i]',
  referenceUploadButton: '[data-testid="upload-reference"], button:has-text("Add image")',
  referenceFileInput: 'input[type="file"]',
  generateButton: '[data-testid="generate-button"], button:has-text("Generate")',
  resultVideo: '[data-testid="result-video"] video, video',
  downloadButton: '[data-testid="download-button"], button:has-text("Download")',
};

// Matches FLOW_BASE_URL in the app's selectors.ts. This copy said `labs.google/flow` long after the
// app moved to the current entry point, which is exactly the drift these two files are prone to.
export const FLOW_BASE_URL = "https://flow.google/";

export const FLOW_TIMEOUTS_MS = {
  navigation: 30_000,
  interaction: 15_000,
  render: 5 * 60_000,
  download: 60_000,
};

/**
 * Builds the {steps, metadata} body for `POST /api/browser-automation/tasks` with
 * `providerId: "google-flow"` — see GoogleFlowProviderAdapter for how each step is interpreted.
 *
 * State-driven, like the app's copy: each phase ends at a `wait_for_state` against the adapter's
 * own reading of the page, so a signed-out session or a verification challenge fails by name in
 * seconds instead of as a selector timeout minutes later. The clicks between them are `optional`
 * because the state check is the real gate.
 */
export function buildGoogleFlowVideoTask({ promptText, referenceImageUrls = [], durationSeconds = 8 }) {
  const clampedDuration = Math.min(8, Math.max(5, durationSeconds));

  const steps = [
    { id: "navigate", action: "navigate", params: { url: FLOW_BASE_URL }, timeoutMs: FLOW_TIMEOUTS_MS.navigation },
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
    { id: "generate", action: "click", params: { selector: FLOW_SELECTORS.generateButton }, expectChange: true },
    { id: "shot-submitted", action: "screenshot", params: { name: "flow_prompt_submitted" } },
    {
      id: "await-clip",
      action: "wait_for_state",
      params: { state: "CLIP_READY", pollMs: 5000 },
      timeoutMs: FLOW_TIMEOUTS_MS.render,
      retryable: false,
    },
    { id: "shot-clip", action: "screenshot", params: { name: "flow_clip_complete" } },
    { id: "download", action: "download_file", params: { selector: FLOW_SELECTORS.downloadButton }, timeoutMs: FLOW_TIMEOUTS_MS.download },
  );

  return { steps, metadata: { promptText, referenceImageUrls, durationSeconds: clampedDuration } };
}
