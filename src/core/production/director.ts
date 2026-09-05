import { generateText, parseJsonResponse } from "@/core/ai/gateway/text";
import type { GenerationAccountContext } from "@/core/ai/types";
import { resolveCostPolicy, type CostPolicy } from "@/core/cost";
import { inferPipeline, getPipeline } from "./pipelines";
import { productionPlanSchema, type PipelineDefinition, type ProductionPlan, type ProductionStage } from "./types";

/**
 * The Production Director.
 *
 * One line in — "Create a 60-second Hindi Instagram Reel explaining the logic behind Sehra in
 * Indian weddings" — a reviewable plan out. It does not generate a script, an image or a frame.
 * It decides what needs making, and the existing stage workers make it.
 *
 * That division is not tidiness. Every stage worker in this codebase already carries its own
 * provider routing, quality checks and retry behaviour; a Director that wrote the script inline
 * would bypass all of it, and the first thing to break would be the thing nobody notices until
 * later — the quality gate that no longer runs.
 */

export interface DirectorRequest {
  /** The user's own words. Not rewritten before it reaches the model. */
  request: string;
  pipelineId?: string;
  language?: string;
  durationSeconds?: number;
  aspectRatio?: ProductionPlan["aspectRatio"];
  costPolicy?: string | null;
  /** Stages the user switched off in the UI. */
  skipStages?: ProductionStage[];
  /** The pooled Google account this run should bill against, resolved by the caller. Planning is a
   *  model call like any other, so it goes through the same account pool as every other stage. */
  account?: GenerationAccountContext;
}

export interface DirectorResult {
  plan: ProductionPlan;
  pipeline: PipelineDefinition;
  /** Stages that will actually run, after skips. */
  stages: ProductionStage[];
  costPolicy: CostPolicy;
  providerId: string;
  /** Anything the Director corrected or could not honour — surfaced, never silently applied. */
  notes: string[];
}

const SYSTEM_PROMPT = `You are a production director for a short-form video studio.

You plan videos. You never write the finished script, never invent asset files, and never claim a
video exists. Your output is a plan that specialist workers will execute.

Rules you must follow:
- Work only from what the request actually says. Do not invent names, dates, places, statistics,
  prices or quotations. If the request implies a factual claim, put it in researchPlan.questions
  and, when it concerns origin, meaning, religion or culture, also in researchPlan.sensitiveClaims.
- Where a custom or practice varies by region or community, plan for the script to say so rather
  than presenting one version as the single true one.
- Respect the requested language, duration and aspect ratio exactly.
- Scene durations must sum to roughly the requested total.
- Narration text in the storyboard is a direction for the script worker, not the final script.

Respond with a single JSON object matching the requested shape and nothing else.`;

function buildPrompt(request: DirectorRequest, pipeline: PipelineDefinition): string {
  const defaults = pipeline.defaults;
  const duration = request.durationSeconds ?? defaults.durationSeconds ?? 60;
  const sceneCount = defaults.sceneCount ?? Math.max(3, Math.round(duration / 8));

  return `Request from the user, verbatim:
"""
${request.request}
"""

Pipeline chosen: ${pipeline.label} — ${pipeline.description}
Guidance for this kind of video: ${pipeline.plannerGuidance}

Constraints:
- language: ${request.language ?? "infer from the request; default en"}
- durationSeconds: ${duration}
- aspectRatio: ${request.aspectRatio ?? defaults.aspectRatio ?? "9:16"}
- platform: ${defaults.platform ?? "instagram-reel"}
- tone: ${defaults.tone ?? "informative"}
- aim for about ${sceneCount} storyboard scenes
- renderer: ${defaults.renderer ?? "ffmpeg"}

Produce a JSON object with exactly these keys:
objective, audience, language, durationSeconds, aspectRatio, platform, tone,
researchPlan { required, questions[], sensitiveClaims[] },
scriptPlan { beats[], hook, callToAction, wordBudget },
storyboard[ { index, visual, narration, camera, emotion, durationSeconds } ],
characters[ { name, role, description } ],
assetRequirements[ { kind, description, sceneIndex } ],
voiceRequirements { narration, language, tone, speaker },
musicRequirements { required, mood },
captionRequirements { required, language, style },
renderingPlan { renderer, width, height, fps },
qualityRequirements { minSceneDurationSeconds, maxSceneDurationSeconds, characterConsistencyThreshold, requireAudio },
publishingPlan { publish, platform, viaBrowserAutomation }`;
}

/**
 * Produces the plan.
 *
 * The model's output is parsed through the schema rather than trusted: a plan with a 40-minute
 * "60 second reel" or nineteen scenes for a twenty-second invitation is a plan that will waste
 * real generation budget. `reconcile` corrects what it can and records every correction in `notes`
 * so the user sees what the Director changed and why.
 */
export async function directProduction(request: DirectorRequest): Promise<DirectorResult> {
  const pipeline = (request.pipelineId ? getPipeline(request.pipelineId) : undefined) ?? inferPipeline(request.request);
  const costPolicy = resolveCostPolicy(request.costPolicy);

  const response = await generateText({
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(request, pipeline),
    json: true,
    temperature: 0.7,
    costPolicy: request.costPolicy,
    account: request.account,
  });

  const raw = parseJsonResponse<unknown>(response.text);
  const parsed = productionPlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `The director produced a plan that does not fit the required shape: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }

  const { plan, notes } = reconcile(parsed.data, request, pipeline);
  const stages = pipeline.stages.filter((stage) => !plan.skippedStages.includes(stage));

  return { plan, pipeline, stages, costPolicy, providerId: response.providerId, notes };
}

/**
 * Brings the model's plan back in line with what was actually asked for.
 *
 * Explicit user constraints win over anything the model decided — if someone asked for 60 seconds
 * in Hindi, a plan for 90 seconds in English is wrong regardless of how good the storyboard is.
 */
export function reconcile(
  plan: ProductionPlan,
  request: DirectorRequest,
  pipeline: PipelineDefinition,
): { plan: ProductionPlan; notes: string[] } {
  const notes: string[] = [];
  const next = { ...plan };

  if (request.durationSeconds && next.durationSeconds !== request.durationSeconds) {
    notes.push(`Duration corrected from ${next.durationSeconds}s to the requested ${request.durationSeconds}s.`);
    next.durationSeconds = request.durationSeconds;
  }
  if (request.aspectRatio && next.aspectRatio !== request.aspectRatio) {
    notes.push(`Aspect ratio corrected to the requested ${request.aspectRatio}.`);
    next.aspectRatio = request.aspectRatio;
  }
  if (request.language && next.language !== request.language) {
    notes.push(`Language corrected to the requested ${request.language}.`);
    next.language = request.language;
    next.voiceRequirements = { ...next.voiceRequirements, language: request.language };
    next.captionRequirements = { ...next.captionRequirements, language: request.language };
  }

  // Scene durations that do not add up mean either a video that overruns its slot or one that
  // stops early — both waste the generation that produced them, so scale rather than discover it
  // at render time.
  const storyboardTotal = next.storyboard.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  if (next.storyboard.length > 0 && Math.abs(storyboardTotal - next.durationSeconds) > next.durationSeconds * 0.2) {
    const factor = next.durationSeconds / storyboardTotal;
    next.storyboard = next.storyboard.map((scene) => ({
      ...scene,
      durationSeconds: Math.max(1, Math.round(scene.durationSeconds * factor * 10) / 10),
    }));
    notes.push(
      `Scene durations summed to ${storyboardTotal.toFixed(1)}s against a ${next.durationSeconds}s target — rescaled to fit.`,
    );
  }

  // Scene indices are what every downstream stage keys on. A gap or a duplicate would silently
  // drop or overwrite a scene, so they are renumbered rather than trusted.
  next.storyboard = next.storyboard
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((scene, index) => ({ ...scene, index }));

  if (request.skipStages?.length) {
    next.skippedStages = [...new Set([...next.skippedStages, ...request.skipStages])];
    const unknown = request.skipStages.filter((stage) => !pipeline.stages.includes(stage));
    if (unknown.length) notes.push(`Ignored skip request for stages this pipeline does not run: ${unknown.join(", ")}.`);
  }

  const renderer = pipeline.defaults.renderer;
  if (renderer && next.renderingPlan.renderer !== renderer) {
    next.renderingPlan = { ...next.renderingPlan, renderer };
    notes.push(`Renderer set to "${renderer}" for the ${pipeline.label} pipeline.`);
  }

  return { plan: next, notes };
}
