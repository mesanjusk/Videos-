import { z } from "zod";

export const updateSceneSchema = z.object({
  characterIds: z.array(z.string()).optional(),
  backgroundId: z.string().nullable().optional(),
  camera: z.string().max(200).optional(),
  emotion: z.string().max(120).optional(),
  dialogue: z.string().max(1000).optional(),
});

export type UpdateSceneInput = z.infer<typeof updateSceneSchema>;

export const completeSceneVideoUploadSchema = z.object({
  taskId: z.string().min(1),
  url: z.string().url(),
  publicId: z.string().min(1),
  durationSeconds: z.number().positive().max(60),
  bytes: z.number().nonnegative().optional(),
});

export type CompleteSceneVideoUploadInput = z.infer<typeof completeSceneVideoUploadSchema>;
