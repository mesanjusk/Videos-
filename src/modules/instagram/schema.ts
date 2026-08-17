import { z } from "zod";

export const updateInstagramAccountSchema = z.object({
  autoReplyEnabled: z.boolean(),
});
export type UpdateInstagramAccountInput = z.infer<typeof updateInstagramAccountSchema>;
