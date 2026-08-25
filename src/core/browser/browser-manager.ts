import type { Browser } from "playwright";
import type { BrowserAutomationEventBus } from "./event-bus";
import { launchChromium } from "./launch";

export interface BrowserManagerOptions {
  headless?: boolean;
  restartOnCrash?: boolean;
}

export interface BrowserManager {
  launch(options?: BrowserManagerOptions): Promise<void>;
  close(): Promise<void>;
  restart(): Promise<void>;
  isHealthy(): Promise<boolean>;
  getBrowser(): Browser | null;
}

/**
 * Launches a single Chromium instance via Playwright. Deliberately generic — no provider-specific
 * launch args, no Google Flow URL. Emits BrowserStarted/BrowserClosed on the shared event bus so
 * the Execution Monitor and dashboard can observe lifecycle without direct coupling.
 */
export class PlaywrightBrowserManager implements BrowserManager {
  private browser: Browser | null = null;
  private lastOptions: BrowserManagerOptions = {};

  constructor(
    private readonly runId: string,
    private readonly eventBus: BrowserAutomationEventBus,
  ) {}

  async launch(options: BrowserManagerOptions = {}): Promise<void> {
    this.lastOptions = options;
    // Launch options come from ./launch so this and BrowserSession cannot disagree about headless.
    this.browser = await launchChromium({ headless: options.headless });
    this.eventBus.emit({ runId: this.runId, event: "BrowserStarted", timestamp: new Date() });
  }

  async close(): Promise<void> {
    if (!this.browser) return;
    await this.browser.close();
    this.browser = null;
    this.eventBus.emit({ runId: this.runId, event: "BrowserClosed", timestamp: new Date() });
  }

  async restart(): Promise<void> {
    await this.close();
    await this.launch(this.lastOptions);
  }

  async isHealthy(): Promise<boolean> {
    return this.browser?.isConnected() ?? false;
  }

  getBrowser(): Browser | null {
    return this.browser;
  }
}
