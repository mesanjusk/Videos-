import { describe, it, expect } from "vitest";
import {
  checkFileIntegrity,
  checkVideoStream,
  checkAudio,
  checkFrameContent,
  checkCaptions,
  checkSceneOrdering,
  checkImageResolution,
  checkVideoDuration,
} from "./checks";
import { decideRetry } from "./retry";
import type { MediaProbe } from "./media-probe";

const probe = (overrides: Partial<MediaProbe> = {}): MediaProbe => ({
  durationSeconds: 60,
  video: { codec: "h264", width: 1080, height: 1920, fps: 30 },
  audio: { codec: "aac", sampleRate: 44100, channels: 2 },
  hasAudio: true,
  unreadable: false,
  raw: "",
  ...overrides,
});

describe("the pre-merge checks still behave exactly as they did", () => {
  it("passes a resolution within tolerance", () => {
    expect(checkImageResolution({ width: 1080, height: 1350 }, { width: 1080, height: 1350 })).toEqual([]);
  });

  it("skips silently when dimensions are unknown rather than treating unknown as wrong", () => {
    expect(checkImageResolution({}, { width: 1080, height: 1350 })).toEqual([]);
  });

  it("keeps duration a warning, never an error", () => {
    const issues = checkVideoDuration(12, 5, 8);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe("warning");
  });
});

describe("file integrity", () => {
  it("errors on a file ffmpeg cannot read", () => {
    const issues = checkFileIntegrity(probe({ unreadable: true }));
    expect(issues[0]!.severity).toBe("error");
  });

  it("says nothing about a readable file", () => {
    expect(checkFileIntegrity(probe())).toEqual([]);
  });
});

describe("video stream", () => {
  it("errors when there is no video stream at all", () => {
    expect(checkVideoStream(probe({ video: undefined }))[0]!.check).toBe("video-stream");
  });

  it("warns rather than errors on a frame rate that is a little off", () => {
    // Re-rendering to fix 29 fps costs more than the defect does.
    const issues = checkVideoStream(probe({ video: { fps: 24, codec: "h264" } }), { expectedFps: 30 });
    expect(issues[0]!.severity).toBe("warning");
  });

  it("says nothing when the frame rate could not be measured", () => {
    expect(checkVideoStream(probe({ video: { codec: "h264" } }), { expectedFps: 30 })).toEqual([]);
  });

  it("flags an unexpected codec", () => {
    const issues = checkVideoStream(probe(), { allowedVideoCodecs: ["h264", "hevc"] });
    expect(issues).toEqual([]);
    expect(checkVideoStream(probe({ video: { codec: "vp9" } }), { allowedVideoCodecs: ["h264"] })[0]!.check).toBe("codec");
  });
});

describe("audio", () => {
  it("errors when narration was expected and there is no audio stream", () => {
    const issues = checkAudio(probe({ hasAudio: false, audio: undefined }), { requireAudio: true });
    expect(issues[0]).toMatchObject({ severity: "error", check: "audio-presence" });
  });

  it("says nothing when audio was not required", () => {
    expect(checkAudio(probe({ hasAudio: false }), { requireAudio: false })).toEqual([]);
  });

  it("does not claim missing audio for a file it could not read", () => {
    expect(checkAudio(probe({ unreadable: true, hasAudio: false }), { requireAudio: true })).toEqual([]);
  });
});

describe("frame content", () => {
  it("errors when most of the video is black", () => {
    const issues = checkFrameContent({ blackRanges: [{ start: 0, end: 50 }], inconclusive: false }, 60);
    expect(issues[0]).toMatchObject({ severity: "error", check: "black-frames" });
  });

  it("only warns about a short black stretch, which is a normal transition", () => {
    const issues = checkFrameContent({ blackRanges: [{ start: 0, end: 2 }], inconclusive: false }, 60);
    expect(issues[0]!.severity).toBe("warning");
  });

  it("reports nothing when the analysis itself failed — absence of evidence is not a pass", () => {
    expect(checkFrameContent({ blackRanges: [], inconclusive: true }, 60)).toEqual([]);
  });
});

describe("captions and ordering", () => {
  it("notices captions were requested and none were produced", () => {
    const issues = checkCaptions({ captionsRequired: true, scenesWithDialogue: 4, captionLinesProduced: 0 });
    expect(issues[0]!.check).toBe("caption-presence");
  });

  it("says nothing when no scene has dialogue", () => {
    expect(checkCaptions({ captionsRequired: true, scenesWithDialogue: 0, captionLinesProduced: 0 })).toEqual([]);
  });

  it("errors on duplicate scene indices, which mean a scene was overwritten", () => {
    const issues = checkSceneOrdering([0, 1, 1, 2]);
    expect(issues[0]).toMatchObject({ severity: "error", check: "scene-ordering" });
  });

  it("warns on a gap in scene indices", () => {
    const issues = checkSceneOrdering([0, 1, 3]);
    expect(issues[0]!.severity).toBe("warning");
    expect(issues[0]!.message).toContain("2");
  });

  it("accepts a clean sequence", () => {
    expect(checkSceneOrdering([0, 1, 2, 3])).toEqual([]);
  });
});

describe("retry targeting", () => {
  it("does not retry for warnings alone", () => {
    const decision = decideRetry([{ severity: "warning", check: "frame-rate", message: "" }]);
    expect(decision.stage).toBeNull();
  });

  it("sends a black-frame failure back to the video stage, not the render", () => {
    // The clip was black before the renderer ever saw it — re-rendering would compose the same
    // black clip again.
    expect(decideRetry([{ severity: "error", check: "black-frames", message: "" }]).stage).toBe("video");
  });

  it("sends missing audio back to the voice stage", () => {
    expect(decideRetry([{ severity: "error", check: "audio-presence", message: "" }]).stage).toBe("voice");
  });

  it("sends a corrupt output back to the render stage", () => {
    expect(decideRetry([{ severity: "error", check: "file-integrity", message: "" }]).stage).toBe("render");
  });

  it("re-runs the earliest implicated stage when several are, since it likely caused the rest", () => {
    const decision = decideRetry([
      { severity: "error", check: "file-integrity", message: "" },
      { severity: "error", check: "resolution", message: "" },
    ]);
    expect(decision.stage).toBe("images");
    expect(decision.reason).toMatch(/earliest/);
  });

  it("asks for a human rather than guessing when no stage owns the fault", () => {
    const decision = decideRetry([{ severity: "error", check: "something-new", message: "" }]);
    expect(decision.stage).toBeNull();
    expect(decision.reason).toMatch(/human/);
  });
});
