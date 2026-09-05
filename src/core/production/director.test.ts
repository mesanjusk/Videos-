import { describe, it, expect } from "vitest";
import { reconcile, coercePlanShape } from "./director";
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

describe("coercePlanShape", () => {
  it("reads a near-miss asset kind rather than discarding the whole plan", () => {
    // The live failure: a complete plan — storyboard, script, cast — thrown away because two asset
    // requirements said "video_clip" where the enum says "video". On a free tier metered in
    // requests per day, replacing that plan can cost the rest of the day.
    const { value, notes } = coercePlanShape({
      objective: "Explain sehra",
      assetRequirements: [
        { kind: "video_clip", description: "groom entering" },
        { kind: "SFX", description: "shehnai" },
      ],
    });

    const plan = productionPlanSchema.parse(value);
    expect(plan.assetRequirements.map((a) => a.kind)).toEqual(["video", "audio"]);
    expect(notes).toHaveLength(2);
  });

  it("clamps a scene duration into the range the schema accepts", () => {
    const { value, notes } = coercePlanShape({
      objective: "x",
      storyboard: [{ index: 0, visual: "a", durationSeconds: 90 }],
    });

    expect(productionPlanSchema.parse(value).storyboard.map((s) => s.durationSeconds)).toEqual([60]);
    expect(notes.join(" ")).toContain("clamped");
  });

  it("leaves a kind it does not recognise alone, so broken output still fails loudly", () => {
    const { value, notes } = coercePlanShape({
      objective: "x",
      assetRequirements: [{ kind: "hologram", description: "?" }],
    });

    expect(notes).toEqual([]);
    expect(productionPlanSchema.safeParse(value).success).toBe(false);
  });

  it("passes anything that is not a plan object straight through", () => {
    expect(coercePlanShape("not a plan").value).toBe("not a plan");
    expect(coercePlanShape(null).value).toBe(null);
  });
});
