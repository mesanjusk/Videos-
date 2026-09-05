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
  | "upload_url"
  | "download_file"
  | "scroll"
  | "drag"
  | "wait"
  | "sleep"
  | "screenshot"
  | "capture_html"
  | "capture_dom"
  // Reads the live DOM and stamps a ref on every visible control, so later steps can address what
  // is really on the page instead of what a selector file guessed would be. See page-probe.ts.
  | "probe_page"
  // Polls the provider's own reading of which screen is displayed, rather than sleeping or waiting
  // on one selector. A provider opts in by implementing `ProviderAdapter.classifyState`.
  | "wait_for_state";

export type BrowserTaskStage =
  | "pending"
  | "claimed"
  | "opening_flow"
  | "uploading_assets"
  | "generating"
  | "combining"
  | "exporting"
  | "completed"
  | "failed";

export interface TaskStep {
  id: string;
  action: ActionType;
  /** Action-specific, e.g. { selector, text } for input_text. Opaque to the framework. */
  params: Record<string, unknown>;
  /** Optional extension-facing lifecycle stage. Server/Playwright runners may ignore it. */
  stage?: BrowserTaskStage;
  verify?: {
    type: "selector_visible" | "url_matches" | "custom";
    params: Record<string, unknown>;
  };
  /**
   * Assert that this action visibly changed the page. A click that lands on a disabled control, or
   * on the wrong one of five identical buttons, otherwise reports success and the run builds its
   * next steps on something that never happened. Opt-in per step, because plenty of legitimate
   * actions (a hover, typing into an already-focused box) change nothing measurable.
   */
  expectChange?: boolean;
  /**
   * A step whose failure does not fail the run. For a site with no DOM contract this is the
   * difference between a working sequence and a fragile one: "click New project" is right when Flow
   * opens on its project list and wrong when it opens straight into a workspace, and neither is an
   * error. The following `wait_for_state` is what actually decides whether the run is where it
   * needs to be — so the click may miss, and the state check may not.
   */
  optional?: boolean;
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
