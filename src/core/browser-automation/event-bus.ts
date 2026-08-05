/**
 * Every subsystem in the framework communicates through this bus rather than direct coupling —
 * the Execution Monitor, dashboards, and persistence layers all subscribe rather than being called
 * into directly. See docs/BROWSER-AUTOMATION-FRAMEWORK-PLAN.md §3/§5.
 */

export type BrowserAutomationEvent =
  | "BrowserStarted"
  | "BrowserClosed"
  | "PageLoaded"
  | "ActionStarted"
  | "ActionCompleted"
  | "ActionFailed"
  | "RetryStarted"
  | "DownloadCompleted"
  | "ExecutionFinished";

export interface EventPayload {
  runId: string;
  event: BrowserAutomationEvent;
  timestamp: Date;
  data?: Record<string, unknown>;
}

export interface BrowserAutomationEventBus {
  emit(payload: EventPayload): void;
  /** Returns an unsubscribe function. */
  on(event: BrowserAutomationEvent, handler: (payload: EventPayload) => void): () => void;
  /** Subscribe to every event, regardless of type — used by the Execution Monitor. */
  onAny(handler: (payload: EventPayload) => void): () => void;
}

/** Minimal in-process implementation — no external dependency needed for a single-worker-process bus. */
export class InMemoryEventBus implements BrowserAutomationEventBus {
  private readonly listeners = new Map<BrowserAutomationEvent, Set<(payload: EventPayload) => void>>();
  private readonly anyListeners = new Set<(payload: EventPayload) => void>();

  emit(payload: EventPayload): void {
    this.listeners.get(payload.event)?.forEach((handler) => handler(payload));
    this.anyListeners.forEach((handler) => handler(payload));
  }

  on(event: BrowserAutomationEvent, handler: (payload: EventPayload) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  onAny(handler: (payload: EventPayload) => void): () => void {
    this.anyListeners.add(handler);
    return () => this.anyListeners.delete(handler);
  }
}
