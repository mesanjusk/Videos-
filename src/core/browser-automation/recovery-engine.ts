import type { TaskStep } from "./types";

export type RecoveryTrigger =
  | "browser_crash"
  | "page_crash"
  | "timeout"
  | "popup"
  | "lost_connection"
  | "unexpected_navigation";

export interface RecoveryContext {
  runId: string;
  trigger: RecoveryTrigger;
  step: TaskStep;
  attempt: number;
}

export type RecoveryAction =
  | { type: "restart_browser" }
  | { type: "resume_state" }
  | { type: "retry_action" }
  | { type: "abort" };

export interface RecoveryEngine {
  recover(context: RecoveryContext): Promise<RecoveryAction>;
}

export interface RecoveryEngineOptions {
  /** How many attempts a step gets before recovery gives up and aborts. Defaults to 3. */
  maxAttempts?: number;
}

/**
 * Generalizes Module 4's circuit-breaker precedent (graceful degrade, never blind retry) across
 * every trigger a browser automation run can hit — provider-agnostic, no Flow-specific handling.
 */
export class DefaultRecoveryEngine implements RecoveryEngine {
  private readonly maxAttempts: number;

  constructor(options: RecoveryEngineOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  async recover(context: RecoveryContext): Promise<RecoveryAction> {
    if (context.attempt >= this.maxAttempts) return { type: "abort" };
    if (context.step.retryable === false) return { type: "abort" };

    switch (context.trigger) {
      case "browser_crash":
      case "lost_connection":
        return { type: "restart_browser" };
      case "page_crash":
      case "unexpected_navigation":
        return { type: "resume_state" };
      case "timeout":
      case "popup":
        return { type: "retry_action" };
      default:
        return { type: "abort" };
    }
  }
}
