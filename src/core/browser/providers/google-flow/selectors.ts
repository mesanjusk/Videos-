/**
 * Centralized Google Flow selectors. Flow has no public DOM contract, so every selector has a
 * semantic/text fallback and the Chrome extension executor tries alternatives in order.
 * Recalibrate here when Flow changes; mission control flow should not need edits.
 */
export const FLOW_BASE_URL = "https://flow.google/";

export const FLOW_SELECTORS = {
  loggedOutMarker: 'a[href*="accounts.google.com"], text=/sign in/i',
  verificationChallenge: 'text=/verify you.?re human/i, iframe[src*="recaptcha"], text=/unusual traffic/i',
  newProjectButton: '[data-testid="new-project-button"], button:has-text("New project"), button:has-text("New Project")',
  promptInput: '[data-testid="prompt-input"], textarea[placeholder*="Describe" i], [contenteditable="true"][role="textbox"]',
  referenceUploadButton: '[data-testid="upload-reference"], button:has-text("Add image"), button:has-text("Upload")',
  referenceFileInput: 'input[type="file"]',
  generateButton: '[data-testid="generate-button"], button:has-text("Generate"), button:has-text("Create")',
  renderingIndicator: '[data-testid="rendering-indicator"], text=/generating/i',
  resultVideo: '[data-testid="result-video"] video, video',
  addToTimelineButton: '[data-testid="add-to-timeline"], button:has-text("Add to timeline"), button:has-text("Add to scene")',
  timeline: '[data-testid="timeline"], [aria-label*="timeline" i]',
  combineButton: '[data-testid="combine-scenes"], button:has-text("Combine"), button:has-text("Merge")',
  combinedPreview: '[data-testid="combined-preview"] video, [data-testid="timeline"] video, video',
  exportButton: '[data-testid="export-button"], button:has-text("Export")',
  exportMp4Button: '[data-testid="export-mp4"], button:has-text("MP4"), [role="menuitem"]:has-text("MP4")',
  downloadButton: '[data-testid="download-button"], button:has-text("Download")',
} as const;

export const FLOW_TIMEOUTS_MS = {
  navigation: 30_000,
  interaction: 15_000,
  render: 5 * 60_000,
  combine: 2 * 60_000,
  download: 2 * 60_000,
} as const;
