import type { BrowserContext } from "playwright";

/**
 * Persistence-agnostic — the framework never talks to Mongo directly (Clean Architecture /
 * Dependency Injection). Concrete implementations (e.g. `MongoSessionStore`) live in
 * `modules/browser-automation/`, injected in from outside `core/browser-automation/`.
 */
export interface SessionStore {
  /** Returns the Playwright storageState() JSON, or null if no session is persisted. */
  load(sessionId: string): Promise<string | null>;
  save(sessionId: string, storageStateJson: string): Promise<void>;
}

export interface SessionManager {
  restore(sessionId: string): Promise<{ storageState: unknown } | null>;
  persist(sessionId: string, context: BrowserContext): Promise<void>;
}

/** Only ever restores/persists a session — never performs a login flow (same rule Module 4 established). */
export class DefaultSessionManager implements SessionManager {
  constructor(private readonly store: SessionStore) {}

  async restore(sessionId: string): Promise<{ storageState: unknown } | null> {
    const json = await this.store.load(sessionId);
    if (!json) return null;
    return { storageState: JSON.parse(json) as unknown };
  }

  async persist(sessionId: string, context: BrowserContext): Promise<void> {
    const storageState = await context.storageState();
    await this.store.save(sessionId, JSON.stringify(storageState));
  }
}
