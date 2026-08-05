import type { Page } from "playwright";

/**
 * One method per ActionType — every action is reusable across any TaskStep/provider. No selector
 * values are hardcoded here; every selector/text/url is passed in by the caller (the
 * ActionPipeline, driven by a provider-supplied TaskStep).
 */
export interface ActionEngine {
  navigate(page: Page, url: string): Promise<void>;
  click(page: Page, selector: string): Promise<void>;
  doubleClick(page: Page, selector: string): Promise<void>;
  rightClick(page: Page, selector: string): Promise<void>;
  hover(page: Page, selector: string): Promise<void>;
  inputText(page: Page, selector: string, text: string): Promise<void>;
  paste(page: Page, selector: string, text: string): Promise<void>;
  keyboardShortcut(page: Page, keys: string): Promise<void>;
  uploadFile(page: Page, selector: string, filePaths: string[]): Promise<void>;
  downloadFile(page: Page, triggerSelector: string): Promise<{ path: string }>;
  scroll(page: Page, selector?: string, deltaY?: number): Promise<void>;
  drag(page: Page, fromSelector: string, toSelector: string): Promise<void>;
  wait(page: Page, selector: string, timeoutMs?: number): Promise<void>;
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
}

/** Generic Playwright-backed implementation. Contains no provider-specific selectors or flows. */
export class PlaywrightActionEngine implements ActionEngine {
  private readonly outputDir: string;

  constructor(options: ActionEngineOptions = {}) {
    this.outputDir = options.outputDir ?? "/tmp/browser-automation";
  }

  async navigate(page: Page, url: string): Promise<void> {
    await page.goto(url);
  }

  async click(page: Page, selector: string): Promise<void> {
    await page.locator(selector).click();
  }

  async doubleClick(page: Page, selector: string): Promise<void> {
    await page.locator(selector).dblclick();
  }

  async rightClick(page: Page, selector: string): Promise<void> {
    await page.locator(selector).click({ button: "right" });
  }

  async hover(page: Page, selector: string): Promise<void> {
    await page.locator(selector).hover();
  }

  async inputText(page: Page, selector: string, text: string): Promise<void> {
    await page.locator(selector).fill(text);
  }

  async paste(page: Page, selector: string, text: string): Promise<void> {
    const locator = page.locator(selector);
    await locator.click();
    await locator.evaluate((el, value) => {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.value = value;
      else el.textContent = value;
    }, text);
  }

  async keyboardShortcut(page: Page, keys: string): Promise<void> {
    await page.keyboard.press(keys);
  }

  async uploadFile(page: Page, selector: string, filePaths: string[]): Promise<void> {
    await page.locator(selector).setInputFiles(filePaths);
  }

  async downloadFile(page: Page, triggerSelector: string): Promise<{ path: string }> {
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator(triggerSelector).click()]);
    const { join } = await import("node:path");
    const path = join(this.outputDir, download.suggestedFilename());
    await download.saveAs(path);
    return { path };
  }

  async scroll(page: Page, selector?: string, deltaY?: number): Promise<void> {
    if (selector) {
      await page.locator(selector).scrollIntoViewIfNeeded();
      return;
    }
    await page.mouse.wheel(0, deltaY ?? 800);
  }

  async drag(page: Page, fromSelector: string, toSelector: string): Promise<void> {
    await page.locator(fromSelector).dragTo(page.locator(toSelector));
  }

  async wait(page: Page, selector: string, timeoutMs?: number): Promise<void> {
    await page.locator(selector).waitFor({ timeout: timeoutMs });
  }

  async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async captureScreenshot(page: Page): Promise<string> {
    const { join } = await import("node:path");
    const path = join(this.outputDir, `screenshot-${Date.now()}.png`);
    await page.screenshot({ path });
    return path;
  }

  async captureHtml(page: Page): Promise<string> {
    return page.content();
  }

  async captureDom(page: Page): Promise<string> {
    return page.evaluate(() => document.documentElement.outerHTML);
  }
}
