import type { ExecutionState } from "./types";

/**
 * Persistence-agnostic — concrete implementation (`MongoStateStore`) is injected in from
 * `modules/browser-automation/`. Same "derive, don't duplicate" caution as
 * `lib/workflow-steps.ts#computeStepStatuses`: the stored state is the source of truth for
 * *resuming*, but liveness/health is always checked fresh via BrowserManager.isHealthy(), never
 * assumed from a possibly-stale persisted field.
 */
export interface StateStore {
  load(runId: string): Promise<{ state: ExecutionState; currentStepIndex: number } | null>;
  save(runId: string, state: ExecutionState, currentStepIndex: number): Promise<void>;
}

export interface StateEngine {
  /**
   * `stepIndex` is optional and defaults to whatever was last persisted — callers that are only
   * changing lifecycle state (e.g. entering "recovering") can omit it; the TaskEngine passes it
   * whenever a step actually completes, which is what makes `resumePoint` advance.
   */
  transition(runId: string, next: ExecutionState, stepIndex?: number): Promise<void>;
  current(runId: string): Promise<ExecutionState>;
  /** Step index to resume from. */
  resumePoint(runId: string): Promise<number>;
}

const VALID_TRANSITIONS: Record<ExecutionState, ExecutionState[]> = {
  idle: ["launching"],
  launching: ["loading", "failed", "cancelled"],
  loading: ["waiting", "failed", "cancelled"],
  // "completed" is reachable directly from "waiting" for the zero-step-task edge case (nothing to
  // execute, so the run never re-enters "executing" at all).
  waiting: ["executing", "cancelled", "failed", "completed"],
  executing: ["waiting", "recovering", "completed", "cancelled", "failed"],
  recovering: ["executing", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

export class DefaultStateEngine implements StateEngine {
  constructor(private readonly store: StateStore) {}

  async transition(runId: string, next: ExecutionState, stepIndex?: number): Promise<void> {
    const existing = await this.store.load(runId);
    const currentState = existing?.state ?? "idle";
    if (next !== currentState) {
      const allowed = VALID_TRANSITIONS[currentState];
      if (!allowed.includes(next)) {
        throw new Error(`Invalid state transition for run ${runId}: ${currentState} -> ${next}`);
      }
    }
    await this.store.save(runId, next, stepIndex ?? existing?.currentStepIndex ?? 0);
  }

  async current(runId: string): Promise<ExecutionState> {
    const existing = await this.store.load(runId);
    return existing?.state ?? "idle";
  }

  async resumePoint(runId: string): Promise<number> {
    const existing = await this.store.load(runId);
    return existing?.currentStepIndex ?? 0;
  }
}
