import { describe, it, expect } from "vitest";
import { isSceneRenderReady, type SceneAssetState } from "./orchestrator";

function scene(overrides: Partial<SceneAssetState> = {}): SceneAssetState {
  return { hasVideo: true, hasVoice: true, hasLipSync: false, hasDialogue: true, ...overrides };
}

describe("isSceneRenderReady", () => {
  it("needs a video clip, always", () => {
    expect(isSceneRenderReady(scene({ hasVideo: false }), false)).toBe(false);
    expect(isSceneRenderReady(scene({ hasVideo: false, hasLipSync: true }), true)).toBe(false);
  });

  it("counts a silent scene as ready on its clip alone", () => {
    expect(isSceneRenderReady(scene({ hasDialogue: false, hasVoice: false }), false)).toBe(true);
    expect(isSceneRenderReady(scene({ hasDialogue: false, hasVoice: false }), true)).toBe(true);
  });

  it("renders a talking scene from its clip and voice track when nothing can lip-sync it", () => {
    // This is the case that mattered: with only the manual lip-sync provider registered, requiring
    // a lip-synced asset here left every project with dialogue one step short of its final file,
    // forever. The renderer composes clip + voice perfectly well.
    expect(isSceneRenderReady(scene({ hasLipSync: false }), false)).toBe(true);
  });

  it("still waits for the lip-synced clip when a provider can actually produce one", () => {
    expect(isSceneRenderReady(scene({ hasLipSync: false }), true)).toBe(false);
    expect(isSceneRenderReady(scene({ hasLipSync: true }), true)).toBe(true);
  });

  it("does not call a talking scene ready with no audio at all", () => {
    expect(isSceneRenderReady(scene({ hasVoice: false, hasLipSync: false }), false)).toBe(false);
  });
});
