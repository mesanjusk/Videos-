import { z } from "zod";

export const createApiTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;
