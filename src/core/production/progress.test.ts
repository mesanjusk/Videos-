import { describe, it, expect } from "vitest";
import { computeProgress, type ProgressInput } from "./progress";

function input(overrides: Partial<ProgressInput> = {}): ProgressInput {
  return {
    projectStatus: "scenes",
    hasFinalVideo: false,
    sceneStatuses: [],
    jobStatuses: [],
    canMakeVideo: true,
    ...overrides,
  };
}

const scenes = (...statuses: string[]) => statuses;

describe("computeProgress", () => {
  it("reports a finished video as finished and stops polling", () => {
    const report = computeProgress(input({ hasFinalVideo: true }));
    expect(report.phase).toBe("ready");
    expect(report.percent).toBe(100);
    expect(report.busy).toBe(false);
  });

  it("keeps polling while anything is still moving", () => {
    expect(computeProgress(input({ sceneStatuses: scenes("image_ready", "pending") })).busy).toBe(true);
  });

  it("does not cry failure while other work is still running", () => {
    // One scene's job failed out of eight; the queue is still working through the rest. Telling
    // someone the whole thing broke here is both wrong and unactionable.
    const report = computeProgress(input({ jobStatuses: ["failed", "running"] }));
    expect(report.phase).not.toBe("problem");
    expect(report.busy).toBe(true);
  });

  it("reports a failure once nothing is left to finish it, and offers a way out of it", () => {
    const report = computeProgress(input({ jobStatuses: ["failed", "completed"] }));
    expect(report.phase).toBe("problem");
    expect(report.busy).toBe(false);
    // A dead end is not a state to leave someone in on the only screen this project has.
    expect(report.action?.target).toBe("retry");
  });

  it("names the one setup step when a scene parks on a human and Flow is not connected", () => {
    const report = computeProgress(
      input({ sceneStatuses: scenes("video_pending_manual"), canMakeVideo: false }),
    );
    expect(report.phase).toBe("waiting");
    expect(report.action?.target).toBe("accounts");
    expect(report.title).toMatch(/connect/i);
  });

  it("does not nag about connecting Flow while the video step has not been reached", () => {
    // Nothing is blocked yet — the story is still being written. Asking for setup now is noise.
    const report = computeProgress(input({ projectStatus: "draft", canMakeVideo: false }));
    expect(report.phase).toBe("writing");
    expect(report.action).toBeUndefined();
  });

  it("waits quietly when a clip is parked but the browser run is still going", () => {
    // `video_pending_manual` with a job still running means the automation is mid-flight; showing a
    // "do this yourself" button in that window is how someone ends up doing work a machine was
    // about to finish.
    const report = computeProgress(
      input({ sceneStatuses: scenes("video_pending_manual"), jobStatuses: ["running"] }),
    );
    expect(report.action).toBeUndefined();
    expect(report.busy).toBe(true);
  });

  it("asks for help only once the automation has actually given up", () => {
    const report = computeProgress(
      input({ sceneStatuses: scenes("video_pending_manual"), jobStatuses: ["completed"] }),
    );
    expect(report.phase).toBe("waiting");
    expect(report.action?.target).toBe("project");
  });

  it("walks through the phases in the order the pipeline actually runs them", () => {
    expect(computeProgress(input({ projectStatus: "draft" })).phase).toBe("writing");
    expect(computeProgress(input({ sceneStatuses: scenes("pending", "pending") })).phase).toBe("drawing");
    expect(computeProgress(input({ sceneStatuses: scenes("image_ready", "pending") })).phase).toBe("filming");
    expect(computeProgress(input({ sceneStatuses: scenes("voice_queued", "video_ready") })).phase).toBe("speaking");
    expect(computeProgress(input({ projectStatus: "rendering", sceneStatuses: scenes("complete") })).phase).toBe("joining");
  });

  it("moves the bar as real work lands, instead of jumping between fixed status values", () => {
    const none = computeProgress(input({ sceneStatuses: scenes("pending", "pending", "pending", "pending") })).percent;
    const some = computeProgress(input({ sceneStatuses: scenes("image_ready", "image_ready", "pending", "pending") })).percent;
    const most = computeProgress(input({ sceneStatuses: scenes("video_ready", "video_ready", "image_ready", "pending") })).percent;

    expect(none).toBeLessThan(some);
    expect(some).toBeLessThan(most);
    expect(most).toBeLessThan(100);
  });

  it("never shows 100% before there is a file to download", () => {
    const report = computeProgress(input({ projectStatus: "rendering", sceneStatuses: scenes("complete", "complete") }));
    expect(report.percent).toBeLessThan(100);
  });

  it("counts scenes for the dots the screen draws", () => {
    const report = computeProgress(input({ sceneStatuses: scenes("video_ready", "complete", "image_ready", "pending") }));
    expect(report.scenesDone).toBe(2);
    expect(report.scenesTotal).toBe(4);
  });

  it("keeps every headline short enough to read at a glance", () => {
    const cases = [
      input({ projectStatus: "draft" }),
      input({ sceneStatuses: scenes("image_ready") }),
      input({ hasFinalVideo: true }),
      input({ jobStatuses: ["failed"] }),
      input({ sceneStatuses: scenes("video_pending_manual"), canMakeVideo: false }),
    ];
    for (const c of cases) {
      expect(computeProgress(c).title.split(" ").length).toBeLessThanOrEqual(4);
    }
  });
});
