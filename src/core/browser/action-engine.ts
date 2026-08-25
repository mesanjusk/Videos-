import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import type { SelectorStrategy, SelectorTarget } from "./shared";
import { resolveTarget, type VisualFallback } from "./selectors/resolver";
import { interpolateWithSecrets } from "./interpolate";

/**
 * One method per ActionType — every action is reusable across any TaskStep/provider. No selector
 * values are hardcoded here; every selector/text/url is passed in by the caller (the
 * ActionPipeline, driven by a provider-supplied TaskStep).
 *
 * ## What the merge changed
 *
 * The original implementation called `page.locator(cssString)` directly. A CSS selector against a
 * third-party product nobody controls is the single most brittle thing in browser automation, and
 * this codebase's own selector files admit as much ("unverified against the live product"). Every
 * selector now goes through Project B's self-healing `resolveTarget`, which tries testId → css →
 * role → text → aria-label → nearby-text → xpath in order and reports which one won — so a
 * provider can supply several ways to find the same element and a product redesign that breaks one
 * of them no longer breaks the run. See docs/MERGE-AUDIT.md §10.
 *
 * A bare string still works and is treated as `{ css }`, so existing provider adapters needed no
 * change; they gain the fallback chain by supplying a richer target.
 *
 * Text passed to `inputText`/`paste` is resolved through `interpolateWithSecrets`, so a step can
 * reference a stored credential as `{{secret:name}}` and the plaintext goes straight into the
 * Playwright call without ever entering the variable bag, a task log, or an AI prompt.
 */

/** A bare string is shorthand for `{ css: string }`. */
export type SelectorInput = string | SelectorTarget;

export interface ActionEngine {
  navigate(page: Page, url: string): Promise<void>;
  click(page: Page, selector: SelectorInput): Promise<void>;
  doubleClick(page: Page, selector: SelectorInput): Promise<void>;
  rightClick(page: Page, selector: SelectorInput): Promise<void>;
  hover(page: Page, selector: SelectorInput): Promise<void>;
  inputText(page: Page, selector: SelectorInput, text: string): Promise<void>;
  paste(page: Page, selector: SelectorInput, text: string): Promise<void>;
  keyboardShortcut(page: Page, keys: string): Promise<void>;
  uploadFile(page: Page, selector: SelectorInput, filePaths: string[]): Promise<void>;
  downloadFile(page: Page, triggerSelector: SelectorInput): Promise<{ path: string }>;
  scroll(page: Page, selector?: SelectorInput, deltaY?: number): Promise<void>;
  drag(page: Page, fromSelector: SelectorInput, toSelector: SelectorInput): Promise<void>;
  wait(page: Page, selector: SelectorInput, timeoutMs?: number): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** Returns a file path. */
  captureScreenshot(page: Page): Promise<string>;
  captureHtml(page: Page): Promise<string>;
  /** Serialized DOM snapshot. */
  captureDom(page: Page): Promise<string>;
}

export interface ActionEngineOptions {
  /** Directory screenshots/downloads are written to. Defaults to the OS temp dir. */
  outputDir?: string;
  /** Variables available to `{{token}}` interpolation in text params. */
  variables?: Record<string, unknown>;
  /** Resolves `{{secret:name}}` just-in-time. Values never reach `variables` or any log. */
  resolveSecret?: (name: string) => Promise<string | undefined>;
  /** Last-resort vision-based element location when every selector strategy fails. */
  visualFallback?: VisualFallback;
  /** Notified with the strategy that actually resolved each element — this is what lets an
   *  operator see that "css stopped working, role is carrying the run" before it fails outright. */
  onSelectorResolved?: (strategy: SelectorStrategy, selector: SelectorInput) => void;
  defaultTimeoutMs?: number;
}

export function toSelectorTarget(selector: SelectorInput): SelectorTarget {
  return typeof selector === "string" ? { css: selector } : selector;
}

/** Generic Playwright-backed implementation. Contains no provider-specific selectors or flows. */
export class PlaywrightActionEngine implements ActionEngine {
  private readonly outputDir: string;
  private readonly options: ActionEngineOptions;

  constructor(options: ActionEngineOptions = {}) {
    this.options = options;
    this.outputDir = options.outputDir ?? "/tmp/browser-automation";
  }

  private async locator(page: Page, selector: SelectorInput, timeoutMs?: number) {
    const { locator, strategy } = await resolveTarget(page, toSelectorTarget(selector), {
      timeout: timeoutMs ?? this.options.defaultTimeoutMs ?? 5000,
      visualFallback: this.options.visualFallback,
    });
    this.options.onSelectorResolved?.(strategy, selector);
    return { locator, strategy };
  }

  private async text(value: string): Promise<string> {
    return interpolateWithSecrets(value, this.options.variables ?? {}, this.options.resolveSecret);
  }

  async navigate(page: Page, url: string): Promise<void> {
    await page.goto(url);
  }

  async click(page: Page, selector: SelectorInput): Promise<void> {
    const { locator } = await this.locator(page, selector);
    await locator.click();
  }

  async doubleClick(page: Page, selector: SelectorInput): Promise<void> {
    const { locator } = await this.locator(page, selector);
    await locator.dblclick();
  }

  async rightClick(page: Page, selector: SelectorInput): Promise<void> {
    const { locator } = await this.locator(page, selector);
    await locator.click({ button: "right" });
  }

  async hover(page: Page, selector: SelectorInput): Promise<void> {
    const { locator } = await this.locator(page, selector);
    await locator.hover();
  }

  async inputText(page: Page, selector: SelectorInput, text: string): Promise<void> {
    const { locator } = await this.locator(page, selector);
    await locator.fill(await this.text(text));
  }

  async paste(page: Page, selector: SelectorInput, text: string): Promise<void> {
    const { locator } = await this.locator(page, selector);
    const value = await this.text(text);
    await locator.click();
    await locator.evaluate((el, v) => {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.value = v;
      else el.textContent = v;
    }, value);
  }

  async keyboardShortcut(page: Page, keys: string): Promise<void> {
    await page.keyboard.press(keys);
  }

  async uploadFile(page: Page, selector: SelectorInput, filePaths: string[]): Promise<void> {
    const { locator } = await this.locator(page, selector);
    await locator.setInputFiles(filePaths);
  }

  async downloadFile(page: Page, triggerSelector: SelectorInput): Promise<{ path: string }> {
    const { locator } = await this.locator(page, triggerSelector);
    const [download] = await Promise.all([page.waitForEvent("download"), locator.click()]);
    await mkdir(this.outputDir, { recursive: true });
    // `suggestedFilename()` is chosen by the remote page. A hostile or merely broken site can
    // suggest "../../etc/cron.d/x"; the original implementation joined it straight onto the output
    // directory. Reduce to a basename and strip anything that isn't filename-safe.
    const target = path.join(this.outputDir, safeFileName(download.suggestedFilename()));
    await download.saveAs(target);
    return { path: target };
  }

  async scroll(page: Page, selector?: SelectorInput, deltaY?: number): Promise<void> {
    if (selector) {
      const { locator } = await this.locator(page, selector);
      await locator.scrollIntoViewIfNeeded();
      return;
    }
    await page.mouse.wheel(0, deltaY ?? 800);
  }

  async drag(page: Page, fromSelector: SelectorInput, toSelector: SelectorInput): Promise<void> {
    const from = await this.locator(page, fromSelector);
    const to = await this.locator(page, toSelector);
    await from.locator.dragTo(to.locator);
  }

  async wait(page: Page, selector: SelectorInput, timeoutMs?: number): Promise<void> {
    // resolveTarget already waits for visibility across its strategy chain.
    await this.locator(page, selector, timeoutMs);
  }

  async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async captureScreenshot(page: Page): Promise<string> {
    await mkdir(this.outputDir, { recursive: true });
    const target = path.join(this.outputDir, `screenshot-${Date.now()}.png`);
    await page.screenshot({ path: target });
    return target;
  }

  async captureHtml(page: Page): Promise<string> {
    return page.content();
  }

  async captureDom(page: Page): Promise<string> {
    return page.evaluate(() => document.documentElement.outerHTML);
  }
}

export function safeFileName(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "_");
  return base || `download-${Date.now()}`;
}
