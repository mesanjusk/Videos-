import { describe, it, expect } from "vitest";
import { buildGoogleFlowVideoTask } from "./build-task";

const PROMPT = "A girl flies a kite over a market at sunrise.";

describe("buildGoogleFlowVideoTask", () => {
  it("checks that Flow is reachable and signed in before it tries to click anything", () => {
    const { steps } = buildGoogleFlowVideoTask({ promptText: PROMPT });
    const firstClick = steps.findIndex((s) => s.action === "click");
    const firstStateCheck = steps.findIndex((s) => s.action === "wait_for_state");
    expect(firstStateCheck).toBeGreaterThanOrEqual(0);
    expect(firstStateCheck).toBeLessThan(firstClick);
  });

  it("reads the real page before entering the prompt", () => {
    const { steps } = buildGoogleFlowVideoTask({ promptText: PROMPT });
    const probe = steps.findIndex((s) => s.action === "probe_page");
    const prompt = steps.findIndex((s) => s.id === "enter-prompt");
    expect(probe).toBeGreaterThanOrEqual(0);
    expect(probe).toBeLessThan(prompt);
  });

  it("treats the navigation clicks as optional and the state checks as the real gate", () => {
    const { steps } = buildGoogleFlowVideoTask({ promptText: PROMPT });
    // "New project" is wrong when Flow opens straight into a workspace, and that is not an error.
    expect(steps.find((s) => s.id === "new-project")?.optional).toBe(true);
    expect(steps.find((s) => s.id === "await-prompt")?.action).toBe("wait_for_state");
  });

  it("requires the Generate click to actually change the page", () => {
    const { steps } = buildGoogleFlowVideoTask({ promptText: PROMPT });
    const generate = steps.find((s) => s.id === "generate");
    expect(generate?.expectChange).toBe(true);
    expect(generate?.optional).toBeUndefined();
  });

  it("waits for the clip by state, and does not retry a render from scratch", () => {
    const { steps } = buildGoogleFlowVideoTask({ promptText: PROMPT });
    const wait = steps.find((s) => s.id === "await-clip");
    expect(wait?.action).toBe("wait_for_state");
    expect(wait?.params.state).toBe("CLIP_READY");
    expect(wait?.retryable).toBe(false);
  });

  it("waits for a clip this run produced, not whatever clip the project already held", () => {
    // A re-run, a resumed job or a second scene in the same workspace opens on a finished clip with
    // a working download button. Without a baseline taken before Generate, the run downloads that
    // one — a valid file of the wrong video, which nothing downstream can detect.
    const { steps } = buildGoogleFlowVideoTask({ promptText: PROMPT });
    const baseline = steps.find((s) => s.id === "await-prompt");
    const wait = steps.find((s) => s.id === "await-clip");

    expect(baseline?.params.recordClips).toBe(true);
    expect(wait?.params.requireNewClip).toBe(true);
    // The baseline is only a baseline if it is taken before the prompt and the Generate click.
    expect(steps.indexOf(baseline!)).toBeLessThan(steps.findIndex((s) => s.id === "generate"));
  });

  it("always ends by downloading the file", () => {
    const { steps } = buildGoogleFlowVideoTask({ promptText: PROMPT });
    expect(steps.at(-1)?.action).toBe("download_file");
  });

  it("names its screenshots so a failed run can be read without replaying it", () => {
    const { steps } = buildGoogleFlowVideoTask({ promptText: PROMPT });
    const shots = steps.filter((s) => s.action === "screenshot");
    expect(shots.length).toBeGreaterThan(0);
    for (const shot of shots) expect(typeof shot.params.name).toBe("string");
  });

  it("only uploads references when there are some", () => {
    const without = buildGoogleFlowVideoTask({ promptText: PROMPT });
    expect(without.steps.some((s) => s.action === "upload_file")).toBe(false);

    const with_ = buildGoogleFlowVideoTask({ promptText: PROMPT, referenceImageUrls: ["https://example.test/a.png"] });
    const upload = with_.steps.find((s) => s.action === "upload_file");
    expect(upload?.params.filesFrom).toBe("referenceImages");
    // Uploading has to happen before the prompt is submitted, or the clip is generated without it.
    expect(with_.steps.indexOf(upload!)).toBeLessThan(with_.steps.findIndex((s) => s.id === "generate"));
  });

  it("clamps the duration to the 5-8s window Flow works in", () => {
    expect(buildGoogleFlowVideoTask({ promptText: PROMPT, durationSeconds: 30 }).metadata.durationSeconds).toBe(8);
    expect(buildGoogleFlowVideoTask({ promptText: PROMPT, durationSeconds: 1 }).metadata.durationSeconds).toBe(5);
  });

  it("gives every step a unique id, since the resume point is keyed on step order", () => {
    const { steps } = buildGoogleFlowVideoTask({ promptText: PROMPT, referenceImageUrls: ["https://example.test/a.png"] });
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
  });
});
