import type { PipelineDefinition } from "./types";

/**
 * Production pipelines as data.
 *
 * Each entry is an ordered list of stages plus defaults and planner guidance — adding a new kind of
 * video is a new entry here, not a new branch inside a growing function. That is the whole point:
 * a single `runProduction()` with a switch on video type is the shape that becomes unmaintainable
 * around the fourth type, and every stage's behaviour ends up duplicated inside it.
 *
 * The stage names refer to work that already exists. `script` is the story job the studio has
 * always run; `images`, `video`, `voice` and `render` are the existing queue processors. The
 * Director sequences them, it does not reimplement them.
 */
export const PRODUCTION_PIPELINES: PipelineDefinition[] = [
  {
    id: "short_reel",
    label: "Short reel",
    description: "A fast vertical explainer for Reels, Shorts or TikTok.",
    stages: ["research", "script", "storyboard", "assets", "images", "video", "voice", "captions", "timeline", "render", "quality", "finalize"],
    defaults: { durationSeconds: 45, aspectRatio: "9:16", platform: "instagram-reel", tone: "energetic", sceneCount: 6 },
    plannerGuidance:
      "Open with a hook in the first two seconds. Keep each scene under eight seconds. One idea per scene. " +
      "End with a single clear takeaway, not a list.",
  },
  {
    id: "wedding_reel",
    label: "Wedding / ceremony reel",
    description: "Explains or celebrates a ceremony or custom, warm in tone, culturally specific.",
    stages: ["research", "factcheck", "script", "storyboard", "characters", "assets", "images", "video", "voice", "captions", "timeline", "render", "quality", "finalize"],
    defaults: { durationSeconds: 60, aspectRatio: "9:16", platform: "instagram-reel", tone: "warm", sceneCount: 8 },
    plannerGuidance:
      "Cultural and religious customs vary by region, community and family. Say which tradition is being described " +
      "rather than presenting one version as universal, and route any claim about origin or meaning through fact-check. " +
      "Where accounts genuinely differ, the script should say so rather than pick one.",
  },
  {
    id: "explainer",
    label: "Explainer",
    description: "Explains how or why something works, in order.",
    stages: ["research", "factcheck", "script", "storyboard", "assets", "images", "voice", "captions", "timeline", "render", "quality", "finalize"],
    defaults: { durationSeconds: 90, aspectRatio: "16:9", platform: "youtube", tone: "informative", sceneCount: 10, renderer: "hybrid" },
    plannerGuidance:
      "Build one step at a time; never assume a step the viewer has not been shown. Prefer a diagram over a " +
      "description where the diagram is clearer — the hybrid renderer can compose it as HTML.",
  },
  {
    id: "documentary",
    label: "Documentary segment",
    description: "A longer, evidence-led piece with narration over sourced material.",
    stages: ["research", "factcheck", "script", "storyboard", "characters", "assets", "images", "video", "voice", "captions", "timeline", "render", "quality", "finalize"],
    defaults: { durationSeconds: 180, aspectRatio: "16:9", platform: "youtube", tone: "measured", sceneCount: 14 },
    plannerGuidance:
      "Every factual claim needs a source recorded in the research stage. Where sources disagree, the narration " +
      "should attribute rather than assert. Avoid dramatising events that are contested.",
  },
  {
    id: "invitation",
    label: "Invitation",
    description: "A short animated invitation card — typography-led.",
    stages: ["script", "storyboard", "assets", "images", "timeline", "render", "quality", "finalize"],
    defaults: { durationSeconds: 20, aspectRatio: "9:16", platform: "whatsapp", tone: "celebratory", sceneCount: 3, renderer: "hybrid" },
    plannerGuidance:
      "The text is the design. Names, dates, times and venue must be exactly as given and never paraphrased or " +
      "invented — if a detail is missing, leave a placeholder and say so rather than filling it in.",
  },
  {
    id: "product_video",
    label: "Product video",
    description: "Shows what a product does and who it is for.",
    stages: ["research", "script", "storyboard", "assets", "images", "video", "voice", "captions", "timeline", "render", "quality", "finalize"],
    defaults: { durationSeconds: 60, aspectRatio: "9:16", platform: "instagram-reel", tone: "confident", sceneCount: 7, renderer: "hybrid" },
    plannerGuidance:
      "Describe only capabilities the brief actually states. Do not invent specifications, prices, availability or " +
      "comparisons with named competitors.",
  },
];

export function getPipeline(id: string): PipelineDefinition | undefined {
  return PRODUCTION_PIPELINES.find((p) => p.id === id);
}

export function listPipelines(): PipelineDefinition[] {
  return PRODUCTION_PIPELINES;
}

/**
 * Picks a pipeline from the user's own words when they did not choose one.
 *
 * Keyword matching, deliberately — not an LLM call. Choosing the pipeline decides which stages run,
 * and spending a model call plus its latency and cost to make that choice before the real planning
 * call is poor value. A wrong guess costs nothing: the pipeline is shown in the plan and the user
 * can change it before anything runs.
 */
export function inferPipeline(request: string): PipelineDefinition {
  const text = request.toLowerCase();
  const rules: [RegExp, string][] = [
    [/\b(invit|rsvp|save the date|nimantran)\b/, "invitation"],
    [/\b(wedding|shaadi|marriage|sehra|baraat|haldi|mehndi|ceremony|ritual|custom|tradition)\b/, "wedding_reel"],
    [/\b(documentary|history of|the story of|investigat)\b/, "documentary"],
    [/\b(product|launch|feature|demo|app|saas)\b/, "product_video"],
    [/\b(explain|how does|why does|what is|guide|tutorial|logic behind)\b/, "explainer"],
  ];

  for (const [pattern, id] of rules) {
    if (pattern.test(text)) {
      const pipeline = getPipeline(id);
      if (pipeline) return pipeline;
    }
  }
  return getPipeline("short_reel")!;
}
