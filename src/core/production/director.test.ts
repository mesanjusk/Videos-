import { describe, it, expect } from "vitest";
import { reconcile } from "./director";
import { coerceToSchema } from "./coerce-to-schema";
import { ASSET_KIND_SYNONYMS } from "./director";
import { inferPipeline, getPipeline, listPipelines, PRODUCTION_PIPELINES } from "./pipelines";
import { productionPlanSchema, type ProductionPlan } from "./types";

function planWith(overrides: Partial<ProductionPlan> = {}): ProductionPlan {
  return productionPlanSchema.parse({
    objective: "Explain sehra",
    researchPlan: {},
    scriptPlan: {},
    voiceRequirements: {},
    musicRequirements: {},
    captionRequirements: {},
    renderingPlan: {},
    qualityRequirements: {},
    publishingPlan: {},
    ...overrides,
  });
}

describe("pipeline inference", () => {
  it("routes a wedding-custom request to the ceremony pipeline", () => {
    expect(inferPipeline("Create a 60-second Hindi Reel explaining the logic behind Sehra in Indian weddings").id).toBe(
      "wedding_reel",
    );
  });

  it("routes an invitation to the invitation pipeline, which is typography-led", () => {
    expect(inferPipeline("Make a save the date invite for our nikah").id).toBe("invitation");
  });

  it("routes a how-does-it-work question to the explainer", () => {
    expect(inferPipeline("Explain how does a heat pump work").id).toBe("explainer");
  });

  it("falls back to a short reel rather than refusing", () => {
    expect(inferPipeline("something about monsoons").id).toBe("short_reel");
  });
});

describe("pipelines are data", () => {
  it("every pipeline ends in finalize and renders before it", () => {
    for (const pipeline of PRODUCTION_PIPELINES) {
      expect(pipeline.stages.at(-1), pipeline.id).toBe("finalize");
      expect(pipeline.stages.indexOf("render")).toBeLessThan(pipeline.stages.indexOf("quality"));
    }
  });

  it("routes culturally sensitive pipelines through fact-check", () => {
    // A pipeline that explains a religious or cultural custom must not be able to skip the stage
    // that checks the claims it is about to make.
    for (const id of ["wedding_reel", "documentary", "explainer"]) {
      expect(getPipeline(id)!.stages, id).toContain("factcheck");
    }
  });

  it("exposes every pipeline through the public list", () => {
    expect(listPipelines().map((p) => p.id)).toEqual([
      "short_reel", "wedding_reel", "explainer", "documentary", "invitation", "product_video",
    ]);
  });
});

describe("reconcile", () => {
  const pipeline = getPipeline("short_reel")!;

  it("makes an explicit user constraint win over the model's choice", () => {
    const { plan, notes } = reconcile(planWith({ durationSeconds: 90, language: "en" }), {
      request: "x",
      durationSeconds: 60,
      language: "hi-IN",
    }, pipeline);

    expect(plan.durationSeconds).toBe(60);
    expect(plan.language).toBe("hi-IN");
    expect(plan.voiceRequirements.language).toBe("hi-IN");
    expect(plan.captionRequirements.language).toBe("hi-IN");
    expect(notes).toHaveLength(2);
  });

  it("rescales scene durations that do not add up to the target", () => {
    const { plan, notes } = reconcile(
      planWith({
        durationSeconds: 60,
        storyboard: [
          { index: 0, visual: "a", narration: "", camera: "wide", emotion: "calm", durationSeconds: 30 },
          { index: 1, visual: "b", narration: "", camera: "wide", emotion: "calm", durationSeconds: 30 },
          { index: 2, visual: "c", narration: "", camera: "wide", emotion: "calm", durationSeconds: 30 },
        ],
      }),
      { request: "x" },
      pipeline,
    );

    const total = plan.storyboard.reduce((sum, s) => sum + s.durationSeconds, 0);
    expect(total).toBeCloseTo(60, 0);
    expect(notes.join(" ")).toMatch(/rescaled/);
  });

  it("leaves durations alone when they are already close enough", () => {
    const { notes } = reconcile(
      planWith({
        durationSeconds: 60,
        storyboard: [{ index: 0, visual: "a", narration: "", camera: "wide", emotion: "calm", durationSeconds: 58 }],
      }),
      { request: "x" },
      pipeline,
    );
    expect(notes.join(" ")).not.toMatch(/rescaled/);
  });

  it("renumbers scenes so a gap cannot silently drop one downstream", () => {
    const { plan } = reconcile(
      planWith({
        storyboard: [
          { index: 5, visual: "c", narration: "", camera: "wide", emotion: "calm", durationSeconds: 8 },
          { index: 0, visual: "a", narration: "", camera: "wide", emotion: "calm", durationSeconds: 8 },
          { index: 5, visual: "b", narration: "", camera: "wide", emotion: "calm", durationSeconds: 8 },
        ],
      }),
      { request: "x" },
      pipeline,
    );
    expect(plan.storyboard.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(plan.storyboard[0]!.visual).toBe("a");
  });

  it("records a skip request for a stage the pipeline does not run, instead of silently ignoring it", () => {
    const { plan, notes } = reconcile(planWith(), { request: "x", skipStages: ["factcheck"] }, pipeline);
    expect(plan.skippedStages).toContain("factcheck");
    expect(notes.join(" ")).toMatch(/does not run/);
  });

  it("applies the pipeline's renderer", () => {
    const { plan } = reconcile(planWith(), { request: "x" }, getPipeline("explainer")!);
    expect(plan.renderingPlan.renderer).toBe("hybrid");
  });
});

describe("plan schema", () => {
  it("rejects a duration outside any sane range rather than planning it", () => {
    expect(() => productionPlanSchema.parse({ objective: "x", durationSeconds: 99999 })).toThrow();
  });

  it("fills sensible defaults so a sparse model response is still usable", () => {
    const plan = productionPlanSchema.parse({ objective: "Explain sehra" });
    expect(plan.aspectRatio).toBe("9:16");
    expect(plan.durationSeconds).toBe(60);
    expect(plan.captionRequirements.required).toBe(true);
    expect(plan.publishingPlan.publish).toBe(false);
  });

  it("defaults publishing to off — planning a video never implies posting it", () => {
    expect(productionPlanSchema.parse({ objective: "x" }).publishingPlan.viaBrowserAutomation).toBe(false);
  });
});

describe("repairing a model's plan against the schema", () => {
  const coerce = (raw: unknown) =>
    coerceToSchema<ProductionPlan>(productionPlanSchema, raw, { synonyms: ASSET_KIND_SYNONYMS });

  it("reads a boolean written as a word", () => {
    // The live failure this generic pass exists for: voiceRequirements.narration came back as
    // "yes". The previous version repaired a hand-written list of fields and this one was not on it.
    const { data, notes } = coerce({ objective: "x", voiceRequirements: { narration: "yes" } });

    expect(data?.voiceRequirements.narration).toBe(true);
    expect(notes.join(" ")).toContain("narration");
  });

  it("reads a number written as a string, units and all", () => {
    const { data } = coerce({ objective: "x", durationSeconds: "60 seconds" });
    expect(data?.durationSeconds).toBe(60);
  });

  it("reads a near-miss asset kind", () => {
    // The earlier live failure: a whole plan discarded because two entries said "video_clip".
    const { data } = coerce({
      objective: "x",
      assetRequirements: [
        { kind: "video_clip", description: "groom entering" },
        { kind: "SFX", description: "shehnai" },
      ],
    });
    expect(data?.assetRequirements.map((a) => a.kind)).toEqual(["video", "audio"]);
  });

  it("reads a lone value where a list belongs", () => {
    const { data } = coerce({ objective: "x", scriptPlan: { beats: "open on the bride" } });
    expect(data?.scriptPlan.beats).toEqual(["open on the bride"]);
  });

  it("repairs several unrelated slips in one response", () => {
    const { data } = coerce({
      objective: "x",
      durationSeconds: "45",
      voiceRequirements: { narration: "true" },
      musicRequirements: { required: "no" },
      assetRequirements: [{ kind: "clip", description: "a" }],
    });

    expect(data?.durationSeconds).toBe(45);
    expect(data?.voiceRequirements.narration).toBe(true);
    expect(data?.musicRequirements.required).toBe(false);
    expect(data?.assetRequirements[0]?.kind).toBe("video");
  });

  it("reads a boolean answered as a sentence that starts with the answer", () => {
    // The exact-word list shipped and failed the same day on "yes, narrated in Hindi". A sentence
    // that opens by answering the question has answered it.
    expect(coerce({ objective: "x", voiceRequirements: { narration: "yes, narrated in Hindi" } }).data
      ?.voiceRequirements.narration).toBe(true);
    expect(coerce({ objective: "x", musicRequirements: { required: "no, silent throughout" } }).data
      ?.musicRequirements.required).toBe(false);
  });

  it("does not read a stray 'no' in the middle as false", () => {
    // "no music, narration throughout" opens with "no" about *music*, and this field is narration.
    // Anchoring to the leading token is what keeps a substring search from inverting the answer.
    expect(coerce({ objective: "x", voiceRequirements: { narration: "narration throughout, no music" } }).data)
      .toBeUndefined();
  });

  it("still fails on a value whose meaning is not obvious", () => {
    // Guessing here would replace a loud error with a plan that quietly says something nobody
    // asked for. "sometimes" is not a boolean and must not be invented into one.
    const { data, issues } = coerce({ objective: "x", voiceRequirements: { narration: "sometimes" } });
    expect(data).toBeUndefined();
    expect(issues.length).toBeGreaterThan(0);
  });

  it("leaves a good plan untouched and reports no repairs", () => {
    const { data, notes } = coerce({ objective: "Explain sehra", durationSeconds: 60 });
    expect(data?.durationSeconds).toBe(60);
    expect(notes).toEqual([]);
  });
});
