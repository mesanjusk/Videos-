import { z } from "zod";
import { VIDEO_STYLES } from "@/modules/projects/constants";

export const styleFieldPack = z.object({
  name: z.string().min(1).max(80),
  category: z.enum(VIDEO_STYLES).default("Custom"),
  lighting: z.string().max(300).optional(),
  colorGrading: z.string().max(300).optional(),
  cameraStyle: z.string().max(300).optional(),
  composition: z.string().max(300).optional(),
  motionStyle: z.string().max(300).optional(),
  renderStyle: z.string().max(300).optional(),
});

export const createStylePackSchema = styleFieldPack;
export const updateStylePackSchema = styleFieldPack.partial();

export type CreateStylePackInput = z.infer<typeof createStylePackSchema>;
export type UpdateStylePackInput = z.infer<typeof updateStylePackSchema>;
