import { describe, expect, it } from "vitest";
import { buildGoogleFlowImageMission } from "./build-image-mission";

const PROMPT = "A girl in a yellow kurta, front view, flat vector style";

describe("buildGoogleFlowImageMission", () => {
  it("captures the result out of the page instead of downloading it", () => {
    // The whole reason this route exists is to get an image back to the app. A Chrome download
    // lands in the operator's own Downloads folder and reports a URL — a `blob:`, or a Google URL
    // needing their cookies — that the server cannot fetch, so the mission completed with its
    // output unreachable and the job waiting for it died at the last step.
    const task = buildGoogleFlowImageMission({ taskId: "task-1", prompt: PROMPT });
    const actions = task.steps.map((step) => step.action);

    expect(actions).toContain("capture_result");
    expect(actions).not.toContain("download_file");
    expect(task.steps.at(-1)).toMatchObject({ action: "capture_result", stage: "exporting" });
  });

  it("captures whatever the page is displaying, still or clip", () => {
    // An image mission that Flow answers with video is still an answer: the frame extractor
    // downstream turns it into the image that was asked for. The capture has to accept both or
    // that tolerance exists nowhere.
    const capture = buildGoogleFlowImageMission({ taskId: "task-1", prompt: PROMPT }).steps.find(
      (step) => step.action === "capture_result",
    );

    expect(String(capture?.params.selector)).toMatch(/img/);
    expect(String(capture?.params.selector)).toMatch(/video/);
    expect(capture?.params.fileName).toBe("google-flow-image.png");
  });

  it("does not retry a finished render from scratch", () => {
    const capture = buildGoogleFlowImageMission({ taskId: "task-1", prompt: PROMPT }).steps.find(
      (step) => step.action === "capture_result",
    );
    expect(capture?.retryable).toBe(false);
  });

  it("waits for a result before trying to capture one", () => {
    const steps = buildGoogleFlowImageMission({ taskId: "task-1", prompt: PROMPT }).steps;
    expect(steps.findIndex((s) => s.id === "wait-result")).toBeLessThan(
      steps.findIndex((s) => s.action === "capture_result"),
    );
  });

  it("carries what the image is for, so the completion path can attach it", () => {
    const task = buildGoogleFlowImageMission({
      taskId: "task-1",
      prompt: PROMPT,
      imageTarget: { kind: "scene", sceneId: "scene-9", jobId: "job-4" },
      projectId: "project-2",
    });

    expect(task.metadata).toMatchObject({
      missionType: "google-flow-image",
      executionTarget: "extension",
      imageTarget: { kind: "scene", sceneId: "scene-9", jobId: "job-4" },
      projectId: "project-2",
    });
  });

  it("uploads references before the prompt, or the face does not survive the image", () => {
    const steps = buildGoogleFlowImageMission({
      taskId: "task-1",
      prompt: PROMPT,
      referenceAssets: [{ url: "https://cdn.example.test/front.png", mimeType: "image/png" }],
    }).steps;

    const upload = steps.findIndex((s) => s.action === "upload_url");
    expect(upload).toBeGreaterThanOrEqual(0);
    expect(upload).toBeLessThan(steps.findIndex((s) => s.id === "enter-prompt"));
  });

  it("gives every step a unique id, since a resume point is keyed on step order", () => {
    const steps = buildGoogleFlowImageMission({
      taskId: "task-1",
      prompt: PROMPT,
      referenceAssets: [{ url: "https://cdn.example.test/front.png" }],
    }).steps;
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
  });
});
