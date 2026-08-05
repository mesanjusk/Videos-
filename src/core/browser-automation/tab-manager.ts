import type { BrowserContext, Page } from "playwright";

export interface TabManager {
  /** Returns the tabId. */
  openTab(context: BrowserContext): Promise<string>;
  closeTab(tabId: string): Promise<void>;
  focus(tabId: string): Promise<void>;
  switchTo(tabId: string): Promise<Page>;
  refresh(tabId: string): Promise<void>;
  /** Re-opens the tab if it crashed. */
  recover(tabId: string): Promise<Page>;
  activeTabId(): string | null;
}

/** Tracks open Playwright pages by an opaque tabId, independent of any provider. */
export class DefaultTabManager implements TabManager {
  private readonly pages = new Map<string, Page>();
  private readonly contexts = new Map<string, BrowserContext>();
  private active: string | null = null;
  private nextId = 1;

  async openTab(context: BrowserContext): Promise<string> {
    const page = await context.newPage();
    const tabId = `tab-${this.nextId++}`;
    this.pages.set(tabId, page);
    this.contexts.set(tabId, context);
    this.active = tabId;
    return tabId;
  }

  async closeTab(tabId: string): Promise<void> {
    const page = this.pages.get(tabId);
    if (!page) return;
    await page.close();
    this.pages.delete(tabId);
    this.contexts.delete(tabId);
    if (this.active === tabId) this.active = null;
  }

  async focus(tabId: string): Promise<void> {
    const page = this.getPageOrThrow(tabId);
    await page.bringToFront();
    this.active = tabId;
  }

  async switchTo(tabId: string): Promise<Page> {
    const page = this.getPageOrThrow(tabId);
    this.active = tabId;
    return page;
  }

  async refresh(tabId: string): Promise<void> {
    const page = this.getPageOrThrow(tabId);
    await page.reload();
  }

  async recover(tabId: string): Promise<Page> {
    const context = this.contexts.get(tabId);
    if (!context) throw new Error(`Cannot recover tab ${tabId}: no known BrowserContext`);
    const existing = this.pages.get(tabId);
    if (existing && !existing.isClosed()) return existing;
    const page = await context.newPage();
    this.pages.set(tabId, page);
    this.active = tabId;
    return page;
  }

  activeTabId(): string | null {
    return this.active;
  }

  private getPageOrThrow(tabId: string): Page {
    const page = this.pages.get(tabId);
    if (!page) throw new Error(`Unknown tabId: ${tabId}`);
    return page;
  }
}
