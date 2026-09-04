/** Zero-import constants shared by Mongoose models and zod schemas. */
export const BROWSER_TASK_RUN_STATES = [
  "idle",
  "launching",
  "loading",
  "waiting",
  "executing",
  "recovering",
  "completed",
  "failed",
  "cancelled",
] as const;
export type BrowserTaskRunState = (typeof BROWSER_TASK_RUN_STATES)[number];

/** Extension/Google Flow lifecycle. Kept separate from the generic TaskEngine state so the
 * existing Playwright runner remains backward compatible. */
export const BROWSER_TASK_STAGES = [
  "pending",
  "claimed",
  "opening_flow",
  "uploading_assets",
  "generating",
  "combining",
  "exporting",
  "completed",
  "failed",
] as const;
export type BrowserTaskStage = (typeof BROWSER_TASK_STAGES)[number];

export const BROWSER_EXECUTION_LOG_LEVELS = ["info", "warn", "error"] as const;
export type BrowserExecutionLogLevel = (typeof BROWSER_EXECUTION_LOG_LEVELS)[number];
