import { z } from "zod";
import { PRODUCTION_PROFILE_STATUSES } from "./constants";

const qualitySchema = z.object({
  minResolutionWidth: z.coerce.number().int().min(100).max(8000).default(1080),
  minResolutionHeight: z.coerce.number().int().min(100).max(8000).default(1350),
  minSceneDurationSeconds: z.coerce.number().min(1).max(60).default(5),
  maxSceneDurationSeconds: z.coerce.number().min(1).max(60).default(8),
  characterConsistencyThreshold: z.coerce.number().min(0).max(1).default(0.45),
  retryStrategy: z.enum(["none", "quality-triggered", "aggressive"]).default("quality-triggered"),
});

const renderSchema = z.object({
  oneSceneAtATime: z.boolean().default(true),
  maxParallelJobs: z.coerce.number().int().min(1).max(10).default(2),
  providerOverrides: z
    .object({
      story: z.string().optional(),
      image: z.string().optional(),
      video: z.string().optional(),
      voice: z.string().optional(),
      lipsync: z.string().optional(),
    })
    .default({}),
  retryDelaySeconds: z.coerce.number().int().min(0).max(3600).default(30),
  automaticContinuation: z.boolean().default(true),
  recoveryStrategy: z.enum(["retry", "manual-handoff", "skip"]).default("manual-handoff"),
});

const profileFields = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  category: z.string().max(60).optional(),
  status: z.enum(PRODUCTION_PROFILE_STATUSES).default("draft"),
  language: z.string().min(2).max(10).default("en"),
  aspectRatio: z.string().max(10).default("9:16"),
  resolution: z.object({ width: z.coerce.number().int().min(100).max(8000), height: z.coerce.number().int().min(100).max(8000) }).default({
    width: 1080,
    height: 1920,
  }),
  fps: z.coerce.number().int().min(1).max(120).default(30),
  sceneDurationSeconds: z.coerce.number().min(1).max(60).default(8),
  defaultSceneCount: z.coerce.number().int().min(1).max(50).default(8),
  characterIds: z.array(z.string()).default([]),
  stylePackId: z.string().optional(),
  voicePackId: z.string().optional(),
  promptTemplateIds: z.array(z.string()).default([]),
  quality: qualitySchema.default({}),
  render: renderSchema.default({}),
});

export const createProductionProfileSchema = profileFields;
export const updateProductionProfileSchema = profileFields.partial();

export type CreateProductionProfileInput = z.infer<typeof createProductionProfileSchema>;
export type UpdateProductionProfileInput = z.infer<typeof updateProductionProfileSchema>;

export const generateFromProfileSchema = z.object({
  topic: z.string().min(3).max(500),
  notes: z.string().max(2000).optional(),
});

export type GenerateFromProfileInput = z.infer<typeof generateFromProfileSchema>;
