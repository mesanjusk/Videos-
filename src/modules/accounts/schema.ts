import { z } from "zod";

export const addGoogleAccountSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(120),
  apiKey: z.string().min(10, "That doesn't look like a valid API key").max(200),
});

export type AddGoogleAccountFormInput = z.infer<typeof addGoogleAccountSchema>;
