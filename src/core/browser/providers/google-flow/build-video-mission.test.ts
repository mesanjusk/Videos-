import { describe, expect, it } from "vitest";
import { buildGoogleFlowVideoMission } from "./build-video-mission";

const PROMPT = "A girl flies a kite over a market at sunrise. Slow push in. Morning light.";

describe("buildGoogleFlowVideoMission", () => {
  it("captures the clip out of the page rather than downloading it", () => {
    // Same reason as the image mission: a Chrome download lands on the operator's disk, where the
    // server cannot read it, and the URL it reports back answers nobody else.
    const steps = buildGoogleFlowVideoMission({ taskId: "t1", prompt: PROMPT }).steps;
    expect(steps.map((s) => s.action)).toContain("capture_result");
    expect(steps.map((s) => s.action)).not.toContain("download_file");
    expect(steps.at(-1)).toMatchObject({ action: "capture_result", stage: "exporting" });
  });

  it("waits for a video, on the render budget rather than the interaction one", () => {
    // A still is seconds and a clip is minutes; waiting for one on the other's clock is how a
    // working render gets abandoned.
    const wait = buildGoogleFlowVideoMission({ taskId: "t1", prompt: PROMPT }).steps.find((s) => s.id === "wait-clip");
    expect(String(wait?.params.selector)).toMatch(/video/);
    expect(wait?.timeoutMs).toBeGreaterThanOrEqual(5 * 60_000);
    expect(wait?.retryable).toBe(false);
  });

  it("does not switch modes on the way", () => {
    // Flow generates video by default. Clicking into stills and back is a step that can only go
    // wrong, so the video mission has no image-mode click at all.
    const steps = buildGoogleFlowVideoMission({ taskId: "t1", prompt: PROMPT }).steps;
    expect(steps.some((s) => s.id === "image-mode")).toBe(false);
  });

  it("carries the cast so the faces survive from the stills into the clip", () => {
    const steps = buildGoogleFlowVideoMission({
      taskId: "t1",
      prompt: PROMPT,
      referenceAssets: [{ url: "https://cdn.example.test/asha-front.png" }],
    }).steps;

    const upload = steps.findIndex((s) => s.action === "upload_url");
    expect(upload).toBeGreaterThanOrEqual(0);
    expect(upload).toBeLessThan(steps.findIndex((s) => s.id === "enter-prompt"));
  });

  it("tells the completion path which scene is waiting on it", () => {
    const task = buildGoogleFlowVideoMission({
      taskId: "t1",
      prompt: PROMPT,
      videoTarget: { kind: "scene-video", sceneId: "scene-9", jobId: "job-4" },
    });
    // Read by flow-image-wake.ts, which is why it keeps that key's name for both kinds of mission.
    expect(task.metadata).toMatchObject({
      missionType: "google-flow-video",
      executionTarget: "extension",
      imageTarget: { kind: "scene-video", sceneId: "scene-9", jobId: "job-4" },
    });
  });

  it("gives every step a unique id, since a resume point is keyed on step order", () => {
    const steps = buildGoogleFlowVideoMission({
      taskId: "t1",
      prompt: PROMPT,
      referenceAssets: [{ url: "https://cdn.example.test/a.png" }],
    }).steps;
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
  });
});
