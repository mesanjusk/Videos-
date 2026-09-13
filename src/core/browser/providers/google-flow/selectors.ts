/**
 * Centralized Google Flow selectors. Flow has no public DOM contract, so every selector has a
 * semantic/text fallback and the Chrome extension executor tries alternatives in order.
 * Recalibrate here when Flow changes; mission control flow should not need edits.
 */
export const FLOW_BASE_URL = "https://flow.google/";

export const FLOW_SELECTORS = {
  loggedOutMarker: 'a[href*="accounts.google.com"], text=/sign in/i',
  verificationChallenge: 'text=/verify you.?re human/i, iframe[src*="recaptcha"], text=/unusual traffic/i',
  // "+ New project" is what Flow's home renders today (observed Aug 2026 in mesanjusk/Automation's
  // driver), and it is a clickable card rather than a <button> — hence the role and text fallbacks.
  newProjectButton:
    '[data-testid="new-project-button"], button:has-text("New project"), [role="button"]:has-text("New project"), ' +
    'text=/\\+?\\s*new project/i, text=/\\+?\\s*new video/i, text=/create a new project/i',
  // Placeholder wording varies by surface ("Describe your idea", "Generate a video", "Ask Flow"),
  // so the shape of the control is the first fallback and the wording the second.
  promptInput:
    '[data-testid="prompt-input"], textarea[placeholder*="Describe" i], textarea[placeholder*="idea" i], ' +
    'textarea[placeholder*="video" i], [contenteditable="true"][role="textbox"], [role="textbox"], textarea',
  referenceUploadButton: '[data-testid="upload-reference"], button:has-text("Add image"), button:has-text("Upload")',
  referenceFileInput: 'input[type="file"]',
  // `arrow_upward` is not a typo: Flow's submit is an icon button whose accessible text is the
  // Material ligature. Automation's driver found it that way against the live product.
  generateButton:
    '[data-testid="generate-button"], button:has-text("Generate"), button:has-text("Create"), ' +
    'button[type="submit"], [role="button"]:has-text("Generate"), text=/^generate( video)?$/i, ' +
    'text=/^(send|submit|run)$/i, [aria-label*="arrow_upward" i], [aria-label*="Send" i]',
  renderingIndicator: '[data-testid="rendering-indicator"], text=/generating/i',
  resultVideo: '[data-testid="result-video"] video, video',

  // ── Image generation ────────────────────────────────────────────────────────────────────────
  // Flow generates stills as well as clips, and the stills are what feed a scene's video as
  // reference material. Same caveat as everything else here: layered guesses, recalibrate against
  // the live product. `imageModeButton` is optional in the mission — a Flow already sitting in
  // image mode has nothing to switch.
  imageModeButton:
    '[data-testid="image-mode"], button:has-text("Image"), [role="tab"]:has-text("Image"), button:has-text("Frames")',
  resultImage: '[data-testid="result-image"] img, [data-testid="generated-image"] img, img[alt*="generated" i]',
  imageDownloadButton:
    '[data-testid="download-image"], button:has-text("Download image"), button:has-text("Download"), [role="menuitem"]:has-text("PNG")',
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
