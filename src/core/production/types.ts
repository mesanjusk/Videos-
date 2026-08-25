import { z } from "zod";

/**
 * The Production Director's output: a plan, not a video.
 *
 * The Director's job is to turn one line of natural language into a structured description of what
 * to make, and then hand each part to a worker that already knows how to make it. It deliberately
 * generates none of the assets itself — the moment a planner starts writing scripts and picking
 * images inline, every existing stage's quality checks, retries and provider routing get bypassed.
 *
 * A plan is reviewable before anything expensive runs, which is the other reason it is a separate
 * artifact: "here is what I am about to make, and what it will cost" is a question the user should
 * get to answer before a single generation is enqueued.
 */

export const PRODUCTION_STAGES = [
  "research",
  "factcheck",
  "script",
  "storyboard",
  "characters",
  "assets",
  "images",
  "video",
  "voice",
  "captions",
  "timeline",
  "render",
  "quality",
  "finalize",
] as const;
export type ProductionStage = (typeof PRODUCTION_STAGES)[number];

export const productionPlanSchema = z.object({
  objective: z.string().min(1),
  audience: z.string().default("general"),
  language: z.string().default("en"),
  durationSeconds: z.number().int().min(5).max(3600).default(60),
  aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:5"]).default("9:16"),
  platform: z.string().default("instagram-reel"),
  tone: z.string().default("informative"),

  researchPlan: z.object({
    required: z.boolean().default(true),
    questions: z.array(z.string()).default([]),
    /** Claims the script must not make without a source. Drives the fact-check stage. */
    sensitiveClaims: z.array(z.string()).default([]),
  }).default({}),

  scriptPlan: z.object({
    beats: z.array(z.string()).default([]),
    hook: z.string().default(""),
    callToAction: z.string().default(""),
    wordBudget: z.number().int().positive().default(150),
  }).default({}),

  storyboard: z
    .array(
      z.object({
        index: z.number().int().min(0),
        visual: z.string(),
        narration: z.string().default(""),
        camera: z.string().default("medium shot"),
        emotion: z.string().default("neutral"),
        durationSeconds: z.number().min(1).max(60).default(8),
      }),
    )
    .default([]),

  characters: z
    .array(z.object({ name: z.string(), role: z.string().default(""), description: z.string().default("") }))
    .default([]),

  assetRequirements: z
    .array(z.object({ kind: z.enum(["image", "video", "audio", "graphic"]), description: z.string(), sceneIndex: z.number().int().optional() }))
    .default([]),

  voiceRequirements: z.object({
    narration: z.boolean().default(true),
    language: z.string().default("en"),
    tone: z.string().default("warm"),
    speaker: z.string().optional(),
  }).default({}),

  musicRequirements: z.object({ required: z.boolean().default(false), mood: z.string().default("") }).default({}),

  captionRequirements: z
    .object({ required: z.boolean().default(true), language: z.string().default("en"), style: z.string().default("burned-in") })
    .default({}),

  renderingPlan: z.object({
    renderer: z.enum(["ffmpeg", "hyperframes", "hybrid"]).default("ffmpeg"),
    width: z.number().int().default(1080),
    height: z.number().int().default(1920),
    fps: z.number().int().default(30),
  }).default({}),

  qualityRequirements: z.object({
    minSceneDurationSeconds: z.number().default(5),
    maxSceneDurationSeconds: z.number().default(8),
    characterConsistencyThreshold: z.number().min(0).max(1).default(0.45),
    requireAudio: z.boolean().default(true),
  }).default({}),

  publishingPlan: z.object({
    publish: z.boolean().default(false),
    platform: z.string().default(""),
    /** Publishing through browser automation is opt-in and never implied by planning one. */
    viaBrowserAutomation: z.boolean().default(false),
  }).default({}),

  /** Stages the user chose to skip. The pipeline honours this. */
  skippedStages: z.array(z.enum(PRODUCTION_STAGES)).default([]),
});

export type ProductionPlan = z.infer<typeof productionPlanSchema>;

export interface PipelineDefinition {
  id: string;
  label: string;
  description: string;
  /** Ordered stages. Data, not a hardcoded function — a new pipeline is a new entry, not new code. */
  stages: ProductionStage[];
  defaults: Partial<Pick<ProductionPlan, "durationSeconds" | "aspectRatio" | "platform" | "tone">> & {
    sceneCount?: number;
    renderer?: "ffmpeg" | "hyperframes" | "hybrid";
  };
  /** Guidance handed to the planner for this kind of video. */
  plannerGuidance: string;
}
