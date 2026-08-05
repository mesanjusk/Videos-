import { z } from "zod";

export const addGoogleAccountSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(120),
  apiKey: z.string().min(10, "That doesn't look like a valid API key").max(200),
});

export type AddGoogleAccountFormInput = z.infer<typeof addGoogleAccountSchema>;

export const saveFlowSessionSchema = z.object({
  storageState: z
    .string()
    .min(1)
    .refine((val) => {
      try {
        const parsed = JSON.parse(val);
        return Array.isArray(parsed.cookies) && Array.isArray(parsed.origins);
      } catch {
        return false;
      }
    }, "That doesn't look like a Playwright storageState() export (expected JSON with cookies/origins)"),
});

export type SaveFlowSessionInput = z.infer<typeof saveFlowSessionSchema>;
