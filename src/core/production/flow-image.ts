import { extractFirstFrameFromUrl } from "@/core/ffmpeg/frame";
import type { GeneratedImage } from "@/core/ai/types";

/**
 * Turning a finished Google Flow mission into an image the pipeline can use.
 *
 * Flow returns a file, and which *kind* of file is not fully in our control: an image mission may
 * come back as a still, or — if Flow was in a video mode, or its UI moved under us — as a clip.
 * Both answer the same question. A clip's first frame is the image that was asked for, so this
 * accepts either rather than failing on a technicality about the container.
 *
 * That is also why the mission's wait step accepts an image *or* a video result: the tolerance has
 * to exist at both ends or it exists at neither.
 */

const VIDEO_MIME = /^video\//i;
const VIDEO_EXTENSION = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;
const IMAGE_MIME = /^image\//i;

export interface MissionDownload {
  path: string;
  url?: string;
}

/** What the extension reports on a completed run, narrowed to what this needs. */
export interface CompletedMission {
  downloads?: MissionDownload[];
}

function looksLikeVideo(url: string, contentType: string | null): boolean {
  if (contentType && VIDEO_MIME.test(contentType)) return true;
  if (contentType && IMAGE_MIME.test(contentType)) return false;
  return VIDEO_EXTENSION.test(url);
}

/**
 * The image bytes from a completed mission.
 *
 * Throws rather than returning null when there is no downloadable result: a mission that reported
 * success with nothing attached is a bug in the run, and silently producing no image would strand
 * the step that is waiting for one.
 */
export async function imageFromMission(mission: CompletedMission): Promise<GeneratedImage> {
  const download = mission.downloads?.find((d) => d.url);
  if (!download?.url) {
    throw new Error(
      "The Flow mission finished without a downloadable file. Nothing was produced to use as an image.",
    );
  }

  const response = await fetch(download.url);
  if (!response.ok) {
    throw new Error(`Could not download the Flow result (HTTP ${response.status}).`);
  }
  const contentType = response.headers.get("content-type");

  if (looksLikeVideo(download.url, contentType)) {
    // Re-fetched inside the extractor rather than streamed through here: it needs the bytes on
    // disk for ffmpeg anyway, and one code path for "clip at a URL" is easier to trust than two.
    const frame = await extractFirstFrameFromUrl(download.url);
    return { data: frame.data, mimeType: frame.mimeType, width: 0, height: 0 };
  }

  const data = Buffer.from(await response.arrayBuffer());
  if (data.length === 0) throw new Error("The Flow result downloaded as an empty file.");

  // Width and height are zero because the bytes have not been decoded here. Every caller uploads
  // through the storage layer, which reports the real dimensions back — and those are what the
  // quality check reads, so measuring twice would only create a second number to disagree with.
  return { data, mimeType: contentType ?? "image/png", width: 0, height: 0 };
}
