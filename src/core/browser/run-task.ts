import { randomUUID } from "node:crypto";
import { InMemoryEventBus } from "./event-bus";
import { PlaywrightBrowserManager } from "./browser-manager";
import { DefaultTabManager } from "./tab-manager";
import { DefaultSessionManager, type SessionStore } from "./session-manager";
import { PlaywrightActionEngine, type ActionEngineOptions } from "./action-engine";
import { DefaultStateEngine, InMemoryStateStore, type StateStore } from "./state-engine";
import { DefaultRecoveryEngine } from "./recovery-engine";
import { EventBusExecutionMonitor } from "./execution-monitor";
import { browserProviderRegistry } from "./provider-adapter";
import { DefaultTaskEngine } from "./task-engine";
import type { BrowserTask, TaskResult, TaskStep } from "./types";

/**
 * Runs one browser task to completion in this process, with no database involvement.
 *
 * The `browser_task` queue processor composes the same pieces against Mongo-backed stores so a run
 * survives a restart and can be paused or cancelled from the dashboard. This is the other half of
 * that: a caller that already owns a session (a pooled Google account's Flow storageState, say) and
 * just wants the clip, synchronously, inside a job it already owns. Both go through the one engine
 * — which is the point of the merge; there is no second code path drivimg Playwright any more.
 */
export interface RunBrowserTaskOptions {
  providerId: string;
  steps: TaskStep[];
  metadata?: Record<string, unknown>;
  /** A ready storageState JSON to restore. Omit for a fresh, logged-out browser. */
  storageStateJson?: string;
  actionEngine?: ActionEngineOptions;
  stateStore?: StateStore;
}

/** A SessionStore over a single caller-supplied storageState — nothing is persisted. */
class EphemeralSessionStore implements SessionStore {
  constructor(private readonly storageStateJson: string) {}
  async load(): Promise<string | null> {
    return this.storageStateJson;
  }
  async save(): Promise<void> {
    // Intentionally a no-op: the session belongs to whoever passed it in (modules/accounts owns
    // the pooled Google sessions), and writing back from here would silently take ownership of it.
  }
}

export async function runBrowserTask(options: RunBrowserTaskOptions): Promise<TaskResult> {
  const runId = randomUUID();
  const eventBus = new InMemoryEventBus();

  const task: BrowserTask = {
    id: runId,
    providerId: options.providerId,
    sessionId: options.storageStateJson ? runId : undefined,
    steps: options.steps,
    metadata: options.metadata,
  };

  const engine = new DefaultTaskEngine({
    eventBus,
    providerRegistry: browserProviderRegistry,
    sessionManager: new DefaultSessionManager(new EphemeralSessionStore(options.storageStateJson ?? "")),
    stateEngine: new DefaultStateEngine(options.stateStore ?? new InMemoryStateStore()),
    recoveryEngine: new DefaultRecoveryEngine(),
    actionEngine: new PlaywrightActionEngine(options.actionEngine),
    createBrowserManager: (id) => new PlaywrightBrowserManager(id, eventBus),
    createTabManager: () => new DefaultTabManager(),
    executionMonitor: new EventBusExecutionMonitor(eventBus),
  });

  return engine.execute(task);
}
