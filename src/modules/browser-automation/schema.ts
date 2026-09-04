import { z } from "zod";
import { BROWSER_TASK_STAGES } from "./constants";

const taskStepSchema = z.object({
  id: z.string().min(1),
  action: z.enum([
    "navigate", "click", "double_click", "right_click", "hover",
    "input_text", "paste", "keyboard_shortcut",
    "upload_file", "upload_url", "download_file",
    "scroll", "drag", "wait", "sleep",
    "screenshot", "capture_html", "capture_dom",
  ]),
  params: z.record(z.string(), z.unknown()).default({}),
  stage: z.enum(BROWSER_TASK_STAGES).optional(),
  verify: z
    .object({
      type: z.enum(["selector_visible", "url_matches", "custom"]),
      params: z.record(z.string(), z.unknown()).default({}),
    })
    .optional(),
  timeoutMs: z.coerce.number().int().min(0).max(600_000).optional(),
  retryable: z.boolean().optional(),
});

export const executeBrowserTaskSchema = z.object({
  providerId: z.string().min(1),
  sessionId: z.string().optional(),
  steps: z.array(taskStepSchema).min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
  projectId: z.string().optional(),
});
export type ExecuteBrowserTaskInput = z.infer<typeof executeBrowserTaskSchema>;

export const extensionTaskUpdateSchema = z.object({
  workerId: z.string().min(1).max(120),
  stage: z.enum(BROWSER_TASK_STAGES),
  currentStepIndex: z.number().int().min(0).optional(),
  error: z.string().max(4000).optional(),
  downloads: z.array(z.object({ path: z.string(), url: z.string().optional() })).optional(),
  resultMetadata: z.record(z.string(), z.unknown()).optional(),
});
export type ExtensionTaskUpdateInput = z.infer<typeof extensionTaskUpdateSchema>;

export const createBrowserSessionSchema = z.object({
  providerId: z.string().min(1),
  label: z.string().min(1).max(80),
  storageStateJson: z.string().min(2),
});
export type CreateBrowserSessionInput = z.infer<typeof createBrowserSessionSchema>;

export const upsertBrowserProviderConfigSchema = z.object({
  providerId: z.string().min(1),
  label: z.string().min(1).max(80),
  enabled: z.boolean().default(true),
  timeoutMs: z.coerce.number().int().min(1000).max(600_000).default(60_000),
  maxAttempts: z.coerce.number().int().min(1).max(10).default(3),
  backoffMs: z.coerce.number().int().min(0).max(60_000).default(2_000),
  settings: z.record(z.string(), z.unknown()).optional(),
});
export type UpsertBrowserProviderConfigInput = z.infer<typeof upsertBrowserProviderConfigSchema>;
