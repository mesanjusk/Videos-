/**
 * Every selector the Google Flow driver depends on, centralized here so recalibrating against a
 * real Flow UI change never means touching the driver's control flow — just this file.
 *
 * IMPORTANT — unverified against the live product: labs.google/flow has no public API and no
 * documented DOM contract, and this environment has no real Google account or network path to it.
 * These selectors are best-effort placeholders following common conventions (data-testid, ARIA
 * roles, visible button text) — they WILL need correcting by an operator with real Flow access
 * before this is relied on. Open each step with Playwright's codegen/inspector
 * (`npx playwright codegen labs.google/flow`) against a real logged-in session and fix whatever
 * doesn't match here. Nothing in google-flow-driver.ts needs to change to do that.
 */
export const FLOW_BASE_URL = "https://labs.google/flow";

export const FLOW_SELECTORS = {
  loggedOutMarker: 'a[href*="accounts.google.com"], text=/sign in/i',
  verificationChallenge: 'text=/verify you.?re human/i, iframe[src*="recaptcha"], text=/unusual traffic/i',
  newProjectButton: '[data-testid="new-project-button"], button:has-text("New project")',
  promptInput: '[data-testid="prompt-input"], textarea[placeholder*="Describe" i]',
  referenceUploadButton: '[data-testid="upload-reference"], button:has-text("Add image")',
  referenceFileInput: 'input[type="file"]',
  generateButton: '[data-testid="generate-button"], button:has-text("Generate")',
  renderingIndicator: '[data-testid="rendering-indicator"], text=/generating/i',
  resultVideo: '[data-testid="result-video"] video, video',
  downloadButton: '[data-testid="download-button"], button:has-text("Download")',
} as const;

/** Bounds on how long each phase is allowed to take before the driver circuit-breaks to manual. */
export const FLOW_TIMEOUTS_MS = {
  navigation: 30_000,
  interaction: 15_000,
  render: 5 * 60_000, // Flow clips are 5-8s; generation itself can still take minutes
  download: 60_000,
} as const;
