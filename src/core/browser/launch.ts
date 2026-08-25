import type { Browser, LaunchOptions } from "playwright";

/**
 * The one place Chromium is launched for browser automation.
 *
 * The engine has two lifecycles on purpose — `PlaywrightBrowserManager` owns a dedicated browser
 * per run so it can restart it after a crash, while `BrowserSession` shares one browser across
 * per-profile contexts — but they were reading `headless` from different places: one from a
 * constructor option defaulting to true, the other from `PLAYWRIGHT_HEADLESS`. Setting
 * `PLAYWRIGHT_HEADLESS=false` to watch a run therefore only worked for half the engine, which is
 * exactly when you least want a surprise.
 *
 * Both now resolve options here. The lifecycles stay separate; the launch does not.
 */
export function resolveLaunchOptions(overrides: { headless?: boolean } = {}): LaunchOptions {
  return {
    headless: overrides.headless ?? process.env.PLAYWRIGHT_HEADLESS !== "false",
  };
}

export async function launchChromium(overrides: { headless?: boolean } = {}): Promise<Browser> {
  const { chromium } = await import("playwright");
  return chromium.launch(resolveLaunchOptions(overrides));
}
