import type { BrowserAutomationEventBus, EventPayload } from "./event-bus";

export interface ExecutionSnapshot {
  runId: string;
  currentAction: string | null;
  executionTimeMs: number;
  retries: number;
  errors: string[];
  screenshots: string[];
  logs: { timestamp: Date; message: string }[];
}

export interface ExecutionMonitor {
  snapshot(runId: string): Promise<ExecutionSnapshot>;
  record(runId: string, entry: { level: "info" | "warn" | "error"; message: string; data?: unknown }): Promise<void>;
}

interface RunState {
  startedAt: number;
  currentAction: string | null;
  retries: number;
  errors: string[];
  screenshots: string[];
  logs: { timestamp: Date; message: string }[];
}

/**
 * Reads the shared EventBus rather than being called into directly by every subsystem — tracks
 * current action, execution time, retries, errors, screenshots, and logs per run, in memory.
 * Persisting this to `BrowserExecutionLog` is the concrete concern of `modules/browser-automation/`.
 */
export class EventBusExecutionMonitor implements ExecutionMonitor {
  private readonly runs = new Map<string, RunState>();

  constructor(eventBus: BrowserAutomationEventBus) {
    eventBus.onAny((payload) => this.handleEvent(payload));
  }

  async snapshot(runId: string): Promise<ExecutionSnapshot> {
    const run = this.getOrCreate(runId);
    return {
      runId,
      currentAction: run.currentAction,
      executionTimeMs: Date.now() - run.startedAt,
      retries: run.retries,
      errors: [...run.errors],
      screenshots: [...run.screenshots],
      logs: [...run.logs],
    };
  }

  async record(runId: string, entry: { level: "info" | "warn" | "error"; message: string; data?: unknown }): Promise<void> {
    const run = this.getOrCreate(runId);
    run.logs.push({ timestamp: new Date(), message: `[${entry.level}] ${entry.message}` });
    if (entry.level === "error") run.errors.push(entry.message);
  }

  private handleEvent(payload: EventPayload): void {
    const run = this.getOrCreate(payload.runId);
    run.logs.push({ timestamp: payload.timestamp, message: payload.event });

    switch (payload.event) {
      case "ActionStarted":
        run.currentAction = (payload.data?.actionId as string) ?? run.currentAction;
        break;
      case "ActionFailed":
        run.errors.push((payload.data?.error as string) ?? "Action failed");
        break;
      case "RetryStarted":
        run.retries += 1;
        break;
      case "DownloadCompleted":
        if (typeof payload.data?.path === "string") run.screenshots.push(payload.data.path);
        break;
      default:
        break;
    }
  }

  private getOrCreate(runId: string): RunState {
    let run = this.runs.get(runId);
    if (!run) {
      run = { startedAt: Date.now(), currentAction: null, retries: 0, errors: [], screenshots: [], logs: [] };
      this.runs.set(runId, run);
    }
    return run;
  }
}
