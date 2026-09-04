import { describe, expect, it } from "vitest";
import { buildGoogleFlowExtensionMission } from "./build-extension-mission";

describe("buildGoogleFlowExtensionMission", () => {
  it("uses Flow for multi-scene generation, combining and final export", () => {
    const task = buildGoogleFlowExtensionMission({
      taskId: "task-1",
      outputFileName: "final.mp4",
      sharedAssets: [{ url: "https://cdn.example.com/character.png", mimeType: "image/png" }],
      scenes: [
        { id: "one", prompt: "Scene one" },
        {
          id: "two",
          prompt: "Scene two",
          referenceAssets: [{ url: "https://cdn.example.com/reference.mp4", mimeType: "video/mp4" }],
        },
      ],
    });

    expect(task.providerId).toBe("google-flow");
    expect(task.metadata).toMatchObject({
      executionTarget: "extension",
      outputSystem: "google-flow",
      ffmpegRole: "fallback-postprocess-only",
      sceneCount: 2,
    });

    const actions = task.steps.map((step) => step.action);
    expect(actions.filter((action) => action === "upload_url")).toHaveLength(2);
    expect(actions.filter((action) => action === "download_file")).toHaveLength(1);
    expect(task.steps.at(-1)).toMatchObject({ action: "download_file", stage: "exporting" });
    expect(task.steps.some((step) => step.stage === "combining")).toBe(true);
    expect(task.steps.some((step) => step.stage === "generating")).toBe(true);

    const videoUpload = task.steps.find((step) => step.id === "scene-2-upload-assets");
    expect(videoUpload?.params.files).toEqual([
      { url: "https://cdn.example.com/reference.mp4", mimeType: "video/mp4" },
    ]);
  });
});
