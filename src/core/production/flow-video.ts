import type { CompletedMission } from "./flow-image";

/**
 * Turning a finished Google Flow mission into the clip the pipeline asked for.
 *
 * The mirror of `flow-image.ts`, and deliberately stricter in one place: an image mission accepts a
 * clip and takes its first frame, because both answer "draw me this". The reverse is not true. A
 * still returned where a clip was wanted is not a video that happens to be short — it is a run that
 * did something else, and turning it into a one-frame file would put a frozen image into the
 * timeline and call the scene finished.
 */

const VIDEO_MIME = /^video\//i;
const VIDEO_EXTENSION = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

/** What `completeSceneVideo` needs, which is the completed arm of `VideoGenerationResult`. */
export interface GeneratedVideo {
  status: "completed";
  data: Buffer;
  mimeType: string;
  durationSeconds: number;
  /** Flow's clips come with sound. See VideoGenerationResult#hasEmbeddedAudio. */
  hasEmbeddedAudio: true;
}

/** Flow's clips are 5-8 seconds; the pipeline's own clamp says the same. */
const ASSUMED_DURATION_SECONDS = 8;

export async function videoFromMission(mission: CompletedMission): Promise<GeneratedVideo> {
  const download = mission.downloads?.find((d) => d.url);
  if (!download?.url) {
    throw new Error(
      "The Flow mission finished without a downloadable file. Nothing was produced to use as a clip.",
    );
  }

  const response = await fetch(download.url);
  if (!response.ok) {
    throw new Error(`Could not download the Flow clip (HTTP ${response.status}).`);
  }

  const contentType = response.headers.get("content-type");
  const looksLikeVideo = (contentType && VIDEO_MIME.test(contentType)) || VIDEO_EXTENSION.test(download.url);
  if (!looksLikeVideo) {
    throw new Error(
      `The Flow mission produced ${contentType ?? "a file"} rather than a clip. A still cannot stand in for a ` +
        "scene's video — the run generated something other than what was asked for.",
    );
  }

  return {
    status: "completed",
    data: Buffer.from(await response.arrayBuffer()),
    mimeType: contentType && VIDEO_MIME.test(contentType) ? contentType : "video/mp4",
    // Measured downstream: `completeSceneVideo` prefers the storage backend's own reading of the
    // file over any claim made here, and checks it against the production profile's target.
    durationSeconds: ASSUMED_DURATION_SECONDS,
    // Flow generates sound along with the picture, so this scene needs no voice track of its own.
    hasEmbeddedAudio: true,
  };
}
