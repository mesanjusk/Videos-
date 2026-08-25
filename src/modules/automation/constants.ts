/**
 * Zero-import constants shared by this module's Mongoose models and its zod schemas — the same
 * pattern `modules/production-profiles/constants.ts` and `modules/browser-automation/constants.ts`
 * established, after a "use client" component transitively importing a model file bloated a route
 * bundle. Never add an import here.
 *
 * These deliberately mirror the runtime arrays in `core/browser/shared/enums.ts` rather than
 * importing them: that file is the vocabulary the engine reasons over, this one is the persistence
 * contract, and they are allowed to drift (a status can be retired from new runs while old
 * documents still carry it). `automation.test.ts` asserts they agree today.
 */

export const AUTOMATION_TASK_STATUSES = [
  "QUEUED",
  "STARTING",
  "RUNNING",
  "WAITING_FOR_HUMAN",
  "RETRYING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type AutomationTaskStatus = (typeof AUTOMATION_TASK_STATUSES)[number];

export const EXECUTION_STEP_STATUSES = ["PENDING", "RUNNING", "SUCCESS", "FAILED", "SKIPPED", "RETRIED"] as const;

export const SCHEDULE_FREQUENCIES = ["ONCE", "HOURLY", "DAILY", "WEEKLY", "CRON"] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

export const HUMAN_INTERVENTION_REASONS = ["CAPTCHA", "MFA", "APPROVAL", "UNKNOWN_STATE", "MANUAL_LOGIN_REQUIRED"] as const;

export const WORKFLOW_STATUSES = ["draft", "published", "archived"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

export const CREDENTIAL_TYPES = ["password", "api_key", "totp_seed", "generic"] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export const TASK_SOURCES = ["api", "dashboard", "schedule", "pipeline"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];
