import { describe, it, expect, afterEach } from "vitest";
import { resolveLaunchOptions } from "./launch";

afterEach(() => delete process.env.PLAYWRIGHT_HEADLESS);

describe("resolveLaunchOptions", () => {
  it("defaults to headless", () => {
    expect(resolveLaunchOptions().headless).toBe(true);
  });

  it("honours PLAYWRIGHT_HEADLESS=false for every launch site, not just one", () => {
    // Before this was centralised, the framework's BrowserManager ignored the variable entirely,
    // so setting it to watch a run worked for workflow runs and silently did nothing for task runs.
    process.env.PLAYWRIGHT_HEADLESS = "false";
    expect(resolveLaunchOptions().headless).toBe(false);
  });

  it("lets an explicit override win over the environment", () => {
    process.env.PLAYWRIGHT_HEADLESS = "false";
    expect(resolveLaunchOptions({ headless: true }).headless).toBe(true);
  });
});
