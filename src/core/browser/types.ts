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
  | "capture_dom";

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
