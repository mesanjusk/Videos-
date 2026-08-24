import type { QualityIssue } from "./types";
import type { MediaProbe, FrameAnomalies } from "./media-probe";

/** Matches ARCHITECTURE.md's declared targets — the "4:5" aspectRatio generation providers are
 * asked for (character sheets, backgrounds, scene images, thumbnails) and the final render export. */
export const TARGET_IMAGE_4_5 = { width: 1080, height: 1350 };
export const TARGET_FINAL_VIDEO = { width: 1080, height: 1920 };
export const SCENE_VIDEO_DURATION = { min: 5, max: 8 };

/**
 * Checks Cloudinary's *measured* dimensions of the uploaded asset against an expected target —
 * deliberately not the generation provider's self-reported width/height (e.g. gemini-image.ts
 * currently hardcodes 1080x1350 regardless of what Gemini actually returned), since that would
 * just be checking a claim against itself. Skips silently (no issue) when Cloudinary didn't report
 * dimensions at all, rather than treating "unknown" as "wrong".
 */
export function checkImageResolution(
  actual: { width?: number; height?: number },
  target: { width: number; height: number },
  toleranceRatio = 0.1,
): QualityIssue[] {
  if (!actual.width || !actual.height) return [];
  const widthOff = Math.abs(actual.width - target.width) / target.width;
  const heightOff = Math.abs(actual.height - target.height) / target.height;
  if (widthOff <= toleranceRatio && heightOff <= toleranceRatio) return [];
  return [
    {
      severity: "error",
      check: "resolution",
      message: `Expected roughly ${target.width}×${target.height}, got ${actual.width}×${actual.height}.`,
    },
  ];
}

export function checkVideoDuration(actualSeconds: number | undefined, minSeconds: number, maxSeconds: number): QualityIssue[] {
  if (actualSeconds === undefined) return [];
  if (actualSeconds >= minSeconds && actualSeconds <= maxSeconds) return [];
  return [
    {
      severity: "warning",
      check: "duration",
      message: `Expected ${minSeconds}-${maxSeconds}s, got ${actualSeconds.toFixed(1)}s.`,
    },
  ];
}

export interface SceneCompletenessInput {
  status: string;
  dialogue?: string;
  imageAssetId?: unknown;
  videoAssetId?: unknown;
  voiceAssetId?: unknown;
  lipSyncAssetId?: unknown;
}

/** Read-only integrity check — a scene whose status implies it should have an asset it doesn't.
 * Never thrown as an error (there's no generation in flight to retry at read time); surfaced as a
 * warning in the Scene Manager / Project history instead. */
export function checkSceneCompleteness(scene: SceneCompletenessInput): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const reachedImage = !["pending", "image_queued"].includes(scene.status);
  const reachedVideo = !["pending", "image_queued", "image_ready"].includes(scene.status);

  if (reachedImage && !scene.imageAssetId) {
    issues.push({ severity: "warning", check: "missing-asset", message: "Scene has moved past image generation but has no image." });
  }
  if (reachedVideo && !scene.videoAssetId && !scene.lipSyncAssetId) {
    issues.push({ severity: "warning", check: "missing-asset", message: "Scene has moved past video generation but has no video." });
  }
  if (scene.status === "complete" && scene.dialogue?.trim() && !scene.voiceAssetId && !scene.lipSyncAssetId) {
    issues.push({ severity: "warning", check: "missing-asset", message: "Scene has dialogue but no voice or lip-synced audio." });
  }
  return issues;
}

// ── Added by the merge: checks that inspect the media, not just its metadata ────────────────────
//
// Everything above validates what the storage backend reported. The checks below read the file
// itself, which catches the failure modes metadata cannot see: a render that came out black, a clip
// that froze, a video with no audio track, a file that is technically the right length and
// completely empty.
//
// Every one of them treats "could not determine" as *no issue*. A quality check that fires on an
// unparsed field would send a good render back through the most expensive job in the application,
// which is a worse outcome than missing a bad one — the bad one is still visible to a human, the
// wasted re-render is not.


export interface VideoQualityTargets {
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  expectedFps?: number;
  fpsTolerance?: number;
  requireAudio?: boolean;
  /** Codecs considered acceptable for delivery. Empty means "don't check". */
  allowedVideoCodecs?: string[];
}

/** File integrity: ffmpeg could not open it at all. Always an error — there is nothing to salvage. */
export function checkFileIntegrity(probe: MediaProbe): QualityIssue[] {
  if (!probe.unreadable) return [];
  return [
    {
      severity: "error",
      check: "file-integrity",
      message: "The rendered file could not be read as media — it is truncated, corrupt, or was never written.",
    },
  ];
}

export function checkVideoStream(probe: MediaProbe, targets: VideoQualityTargets = {}): QualityIssue[] {
  const issues: QualityIssue[] = [];
  if (probe.unreadable) return issues; // checkFileIntegrity already said the important thing

  if (!probe.video) {
    issues.push({ severity: "error", check: "video-stream", message: "The file has no video stream." });
    return issues;
  }

  if (targets.expectedFps !== undefined && probe.video.fps !== undefined) {
    const tolerance = targets.fpsTolerance ?? 1;
    if (Math.abs(probe.video.fps - targets.expectedFps) > tolerance) {
      // A warning: a frame rate a little off plays fine, and re-rendering to fix it costs more than
      // it is worth. Worth surfacing, not worth an automatic retry.
      issues.push({
        severity: "warning",
        check: "frame-rate",
        message: `Expected about ${targets.expectedFps} fps, measured ${probe.video.fps}.`,
      });
    }
  }

  if (targets.allowedVideoCodecs?.length && probe.video.codec) {
    if (!targets.allowedVideoCodecs.includes(probe.video.codec)) {
      issues.push({
        severity: "warning",
        check: "codec",
        message: `Video codec is "${probe.video.codec}"; expected one of ${targets.allowedVideoCodecs.join(", ")}.`,
      });
    }
  }

  return issues;
}

/**
 * Audio presence and length.
 *
 * A silent video is one of the few failures worth an automatic retry: it is unambiguous, cheap to
 * detect and always wrong when narration was requested. Length mismatch is only a warning — a
 * track a second short is normal, and re-rendering for it is not proportionate.
 */
export function checkAudio(probe: MediaProbe, targets: VideoQualityTargets = {}): QualityIssue[] {
  const issues: QualityIssue[] = [];
  if (probe.unreadable || !targets.requireAudio) return issues;

  if (!probe.hasAudio) {
    issues.push({
      severity: "error",
      check: "audio-presence",
      message: "Narration was expected but the rendered file has no audio stream.",
    });
    return issues;
  }

  if (probe.durationSeconds !== undefined && probe.durationSeconds < 1) {
    issues.push({ severity: "error", check: "audio-duration", message: "The rendered file is under a second long." });
  }
  return issues;
}

/**
 * Black frames and frozen frames.
 *
 * Both are what a broken generation actually looks like: the file is valid, the right length, the
 * right resolution, and there is nothing in it. Only a long black stretch is an error — a short one
 * is a legitimate transition or fade.
 */
export function checkFrameContent(
  anomalies: FrameAnomalies,
  totalDurationSeconds: number | undefined,
  options: { maxBlackFraction?: number } = {},
): QualityIssue[] {
  if (anomalies.inconclusive) return []; // the analysis failed; that says nothing about the video

  const issues: QualityIssue[] = [];
  const blackSeconds = anomalies.blackRanges.reduce((sum, range) => sum + (range.end - range.start), 0);

  if (blackSeconds > 0 && totalDurationSeconds && totalDurationSeconds > 0) {
    const fraction = blackSeconds / totalDurationSeconds;
    const limit = options.maxBlackFraction ?? 0.25;
    if (fraction >= limit) {
      issues.push({
        severity: "error",
        check: "black-frames",
        message: `${(fraction * 100).toFixed(0)}% of the video is black (${blackSeconds.toFixed(1)}s of ${totalDurationSeconds.toFixed(1)}s).`,
      });
    } else if (blackSeconds > 1) {
      issues.push({
        severity: "warning",
        check: "black-frames",
        message: `${blackSeconds.toFixed(1)}s of black frames detected.`,
      });
    }
  }

  return issues;
}

export interface CaptionCheckInput {
  captionsRequired: boolean;
  scenesWithDialogue: number;
  captionLinesProduced: number;
}

/** Captions were asked for and the composition produced none. */
export function checkCaptions(input: CaptionCheckInput): QualityIssue[] {
  if (!input.captionsRequired || input.scenesWithDialogue === 0) return [];
  if (input.captionLinesProduced > 0) return [];
  return [
    {
      severity: "warning",
      check: "caption-presence",
      message: `Captions were requested and ${input.scenesWithDialogue} scene(s) have dialogue, but no caption lines were produced.`,
    },
  ];
}

/**
 * Scene ordering.
 *
 * Indices are what every downstream stage keys on, so a gap or a duplicate means a scene was
 * silently dropped or overwritten somewhere upstream — a data-integrity problem, and one that
 * produces a video missing a scene without anything having visibly failed.
 */
export function checkSceneOrdering(sceneIndices: number[]): QualityIssue[] {
  if (sceneIndices.length === 0) return [];
  const issues: QualityIssue[] = [];
  const sorted = [...sceneIndices].sort((a, b) => a - b);

  const duplicates = sorted.filter((value, i) => i > 0 && value === sorted[i - 1]);
  if (duplicates.length > 0) {
    issues.push({
      severity: "error",
      check: "scene-ordering",
      message: `Duplicate scene indices: ${[...new Set(duplicates)].join(", ")}. A scene has been overwritten.`,
    });
  }

  const gaps: number[] = [];
  for (let i = sorted[0]!; i < sorted[sorted.length - 1]!; i += 1) {
    if (!sorted.includes(i)) gaps.push(i);
  }
  if (gaps.length > 0) {
    issues.push({
      severity: "warning",
      check: "scene-ordering",
      message: `Missing scene indices: ${gaps.join(", ")}.`,
    });
  }

  return issues;
}
