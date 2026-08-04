import { z } from "zod";
import { BACKGROUND_CATEGORIES } from "./models/Background";

export const createBackgroundSchema = z.object({
  name: z.string().min(1).max(60),
  category: z.enum(BACKGROUND_CATEGORIES).default("custom"),
  description: z.string().min(3).max(500),
  lighting: z.string().max(60).default("morning"),
});

export type CreateBackgroundInput = z.infer<typeof createBackgroundSchema>;
