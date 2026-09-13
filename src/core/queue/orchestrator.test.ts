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

describe("a clip that speaks for itself", () => {
  // Google Flow generates sound along with the picture. For those scenes the voice step would
  // synthesise a second reading of a line the clip has already delivered, and the lip-sync step
  // would try to match a mouth to the wrong one of the two.
  it("is ready on its clip alone, with no voice track and none coming", () => {
    expect(isSceneRenderReady(scene({ hasVoice: false, videoHasAudio: true }), false)).toBe(true);
  });

  it("does not wait for a lip-sync pass even where one is available", () => {
    // Waiting would hold the render forever: nothing enqueues voice or lip-sync for this scene, so
    // the asset it is waiting for is never going to arrive.
    expect(isSceneRenderReady(scene({ hasVoice: false, hasLipSync: false, videoHasAudio: true }), true)).toBe(true);
  });

  it("changes nothing for a clip that does not carry audio", () => {
    // The flag is set by the provider that made the clip, never guessed — a hand-uploaded video
    // may or may not have sound, so absent means the pipeline behaves exactly as it always did.
    expect(isSceneRenderReady(scene({ hasVoice: false, videoHasAudio: false }), false)).toBe(false);
    expect(isSceneRenderReady(scene({ hasVoice: false }), false)).toBe(false);
  });
});
