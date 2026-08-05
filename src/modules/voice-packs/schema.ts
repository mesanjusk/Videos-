import { z } from "zod";

const voiceFieldPack = z.object({
  name: z.string().min(1).max(80),
  gender: z.enum(["male", "female", "child", "narrator"]).default("narrator"),
  language: z.string().min(2).max(10).default("en"),
  speakingSpeed: z.coerce.number().min(0.5).max(2).default(1),
  emotion: z.string().max(60).optional(),
});

export const createVoicePackSchema = voiceFieldPack;
export const updateVoicePackSchema = voiceFieldPack.partial();

export type CreateVoicePackInput = z.infer<typeof createVoicePackSchema>;
export type UpdateVoicePackInput = z.infer<typeof updateVoicePackSchema>;
