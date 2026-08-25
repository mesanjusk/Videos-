/**
 * Core, provider-agnostic types for the Browser Automation Framework (Module 7A).
 * See docs/BROWSER-AUTOMATION-FRAMEWORK-PLAN.md §5. Zero Google Flow / provider-specific content —
 * `ActionType` is a generic vocabulary, `params`/`metadata` are opaque `Record<string, unknown>`
 * bags a provider adapter interprets.
 */

export type ActionType =
  | "navigate"
  | "click"
  | "double_click"
  | "right_click"
  | "hover"
  | "input_text"
  | "paste"
  | "keyboard_shortcut"
  | "upload_file"
  | "download_file"
  | "scroll"
  | "drag"
  | "wait"
  | "sleep"
  | "screenshot"
  | "capture_html"
  | "capture_dom";

export interface TaskStep {
  id: string;
  action: ActionType;
  /** Action-specific, e.g. { selector, text } for input_text. Opaque to the framework. */
  params: Record<string, unknown>;
  verify?: {
    type: "selector_visible" | "url_matches" | "custom";
    params: Record<string, unknown>;
  };
  timeoutMs?: number;
  /** Defaults to true. */
  retryable?: boolean;
}

/** Serializable — a BrowserTask can be stored as plain JSON (BrowserTaskRun.taskDefinition). */
export interface BrowserTask {
  id: string;
  providerId: string;
  /** Which persisted session to restore, if any. */
  sessionId?: string;
  steps: TaskStep[];
  /** Provider-defined, opaque to the framework. */
  metadata?: Record<string, unknown>;
}

export type ExecutionState =
  | "idle"
  | "launching"
  | "loading"
  | "waiting"
  | "executing"
  | "recovering"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Where a failed run gave out.
 *
 * "setup" means the browser or the page never got as far as executing a step — a launch failure, a
 * missing Chromium, an unusable session. Those are infrastructure problems: the right response is
 * to let the job fail so the queue retries it later.
 *
 * "step" means the automation reached the site and an interaction went wrong — a changed selector,
 * a verification challenge, a render that never finished. Retrying that immediately just repeats
 * it; the right response is to degrade to whatever manual path the caller has.
 *
 * Collapsing the two (which the framework did before the merge, reporting only `state: "failed"`)
 * meant a caller had to guess from the error text. `core/ai/providers/google/google-flow-automated.ts`
 * needs exactly this distinction to preserve the behaviour Module 4's circuit breaker had.
 */
export type FailureStage = "setup" | "step";

export interface TaskResult {
  taskId: string;
  state: ExecutionState;
  completedSteps: number;
  totalSteps: number;
  error?: string;
  failureStage?: FailureStage;
  downloads: { path: string; url?: string }[];
  screenshots: string[];
}
