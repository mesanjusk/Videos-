import { writeFile, unlink, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { withBrowserSession } from "./browser-session";
import { FLOW_BASE_URL, FLOW_SELECTORS, FLOW_TIMEOUTS_MS } from "./selectors";
import { AutomationCircuitBreakerError } from "./errors";
import type { FlowAutomationInput, FlowAutomationResult } from "./types";

async function assertNoCircuitBreak(page: Page): Promise<void> {
  if (await page.locator(FLOW_SELECTORS.verificationChallenge).first().isVisible().catch(() => false)) {
    throw new AutomationCircuitBreakerError(
      "verification_challenge",
      "Google presented a verification challenge — automation cannot solve this, falling back to manual.",
    );
  }
  if (await page.locator(FLOW_SELECTORS.loggedOutMarker).first().isVisible().catch(() => false)) {
    throw new AutomationCircuitBreakerError(
      "session_expired",
      "The saved Flow session looks logged out — reconnect this account's browser session.",
    );
  }
}

/** Downloads each reference image to a temp file — Flow's file input needs a local path, not a URL. */
async function downloadReferenceImages(urls: string[], dir: string): Promise<string[]> {
  const paths: string[] = [];
  for (const [index, url] of urls.entries()) {
    const res = await fetch(url);
    if (!res.ok) continue; // best-effort — a missing reference shouldn't abort the whole run
    const buffer = Buffer.from(await res.arrayBuffer());
    const path = join(dir, `reference-${index}.png`);
    await writeFile(path, buffer);
    paths.push(path);
  }
  return paths;
}

/**
 * Drives labs.google/flow end to end: open a new project, upload character references, paste the
 * prompt, generate, wait for the render, download the clip. Every interaction is wrapped so a
 * missing/changed selector or an unexpected page state throws `AutomationCircuitBreakerError`
 * rather than hanging or retrying blindly — the caller (google-flow-automated.ts) catches that and
 * falls back to the existing manual hand-off.
 *
 * See selectors.ts for the "unverified against the live product" caveat — this control flow is the
 * stable part; the selectors are what an operator recalibrates.
 */
export async function runGoogleFlowAutomation(
  storageStateJson: string,
  input: FlowAutomationInput,
): Promise<FlowAutomationResult> {
  const tmpDir = await mkdtemp(join(tmpdir(), "flow-automation-"));
  try {
    return await withBrowserSession({ storageStateJson }, async (page) => {
      page.setDefaultTimeout(FLOW_TIMEOUTS_MS.interaction);

      await page.goto(FLOW_BASE_URL, { timeout: FLOW_TIMEOUTS_MS.navigation, waitUntil: "domcontentloaded" });
      await assertNoCircuitBreak(page);

      await clickOrBreak(page, FLOW_SELECTORS.newProjectButton, "new project button");

      const referencePaths = await downloadReferenceImages(input.characterReferenceImageUrls, tmpDir);
      if (referencePaths.length > 0) {
        await clickOrBreak(page, FLOW_SELECTORS.referenceUploadButton, "reference upload button");
        const fileInput = page.locator(FLOW_SELECTORS.referenceFileInput).first();
        await fileInput.setInputFiles(referencePaths).catch(() => {
          throw new AutomationCircuitBreakerError("selector_not_found", "Couldn't find Flow's reference image file input.");
        });
      }

      const promptInput = page.locator(FLOW_SELECTORS.promptInput).first();
      await promptInput.waitFor({ state: "visible" }).catch(() => {
        throw new AutomationCircuitBreakerError("selector_not_found", "Couldn't find Flow's prompt input.");
      });
      await promptInput.fill(input.promptText);

      await clickOrBreak(page, FLOW_SELECTORS.generateButton, "generate button");
      await assertNoCircuitBreak(page);

      // Poll for the render to finish rather than a single long wait — lets us re-check for a
      // verification challenge appearing mid-render, and bounds total time explicitly.
      const deadline = Date.now() + FLOW_TIMEOUTS_MS.render;
      let rendered = false;
      while (Date.now() < deadline) {
        await assertNoCircuitBreak(page);
        const stillRendering = await page.locator(FLOW_SELECTORS.renderingIndicator).first().isVisible().catch(() => false);
        const hasResult = await page.locator(FLOW_SELECTORS.resultVideo).first().isVisible().catch(() => false);
        if (hasResult && !stillRendering) {
          rendered = true;
          break;
        }
        await page.waitForTimeout(5_000);
      }
      if (!rendered) {
        throw new AutomationCircuitBreakerError("timeout", "Flow didn't finish rendering within the allotted time.");
      }

      const downloadPromise = page.waitForEvent("download", { timeout: FLOW_TIMEOUTS_MS.download });
      await clickOrBreak(page, FLOW_SELECTORS.downloadButton, "download button");
      const download = await downloadPromise.catch(() => {
        throw new AutomationCircuitBreakerError("timeout", "Flow's download never started.");
      });

      const downloadPath = join(tmpDir, "clip.mp4");
      await download.saveAs(downloadPath);
      const videoBuffer = await readFile(downloadPath);
      await unlink(downloadPath).catch(() => {});

      return { videoBuffer, mimeType: "video/mp4", durationSeconds: input.durationSeconds };
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function clickOrBreak(page: Page, selector: string, label: string): Promise<void> {
  const locator = page.locator(selector).first();
  await locator.waitFor({ state: "visible" }).catch(() => {
    throw new AutomationCircuitBreakerError("selector_not_found", `Couldn't find Flow's ${label} — its UI may have changed.`);
  });
  await locator.click();
}
