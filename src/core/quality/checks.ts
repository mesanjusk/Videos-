import type { QualityIssue } from "./types";

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
