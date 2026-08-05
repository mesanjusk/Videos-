import { z } from "zod";

const taskStepSchema = z.object({
  id: z.string().min(1),
  action: z.enum([
    "navigate", "click", "double_click", "right_click", "hover",
    "input_text", "paste", "keyboard_shortcut",
    "upload_file", "download_file",
    "scroll", "drag", "wait", "sleep",
    "screenshot", "capture_html", "capture_dom",
  ]),
  params: z.record(z.string(), z.unknown()).default({}),
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
