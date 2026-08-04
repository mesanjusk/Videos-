import { z } from "zod";

export const createCharacterSchema = z.object({
  name: z.string().min(1).max(60),
  role: z.string().max(60).optional(),
  age: z.string().max(60).optional(),
  bodyType: z.string().max(120).optional(),
  face: z.string().max(200).optional(),
  eyes: z.string().max(120).optional(),
  hair: z.string().max(120).optional(),
  clothes: z.string().max(200).optional(),
  shoes: z.string().max(120).optional(),
  accessories: z.string().max(200).optional(),
  personality: z.string().max(200).optional(),
});

export type CreateCharacterInput = z.infer<typeof createCharacterSchema>;
