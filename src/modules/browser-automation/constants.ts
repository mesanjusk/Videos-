/**
 * Zero-import constants shared by both Mongoose models and zod schemas in this module — the same
 * pattern established for `modules/production-profiles/constants.ts` (Module 6) after a "use
 * client" component transitively importing a Mongoose model file bloated a route to 327kB. Never
 * add an import here.
 *
 * These mirror `ExecutionState` from `core/browser-automation/types.ts` but are their own runtime
 * source of truth for persistence — the framework core stays Mongoose-free, so it cannot export a
 * runtime array for this file to import.
 */

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

export const BROWSER_EXECUTION_LOG_LEVELS = ["info", "warn", "error"] as const;
export type BrowserExecutionLogLevel = (typeof BROWSER_EXECUTION_LOG_LEVELS)[number];
