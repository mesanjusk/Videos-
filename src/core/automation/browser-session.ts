import { chromium, type Page } from "playwright";

export interface BrowserSessionOptions {
  /** Playwright `context.storageState()` JSON — cookies + localStorage from a prior manual login. */
  storageStateJson: string;
  headless?: boolean;
}

/**
 * Launches a Chromium browser pre-authenticated with a saved session, runs `run`, and always tears
 * the browser down afterward — success, circuit-break, or unexpected error alike. Never call this
 * outside worker.ts's process; a headless Chromium download/launch has no place in a Vercel
 * serverless function (time limits, no guaranteed browser binary, bundle size).
 */
export async function withBrowserSession<T>(options: BrowserSessionOptions, run: (page: Page) => Promise<T>): Promise<T> {
  const storageState = JSON.parse(options.storageStateJson);
  const browser = await chromium.launch({ headless: options.headless ?? true });
  try {
    const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 } });
    try {
      const page = await context.newPage();
      return await run(page);
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
