import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = ffmpegPath as unknown as string;

/**
 * A still image out of a video clip.
 *
 * This is how this studio generates images without an image API. Google Flow makes video and does
 * not meter it the way the Gemini free tier meters images — where an image model can answer
 * `limit: 0` on a key that has generated nothing all week. A one-second clip's first frame is an
 * image, produced by a route that is already paid for.
 *
 * Frame *one* specifically, not a frame sampled from the middle: generative video tends to drift
 * from the prompt as a clip goes on, so the opening frame is the one closest to what was asked for.
 * It is also the only frame guaranteed to exist — a clip shorter than expected still has a first
 * frame, while `-ss 2` on a 1.5-second clip silently produces nothing.
 */

export interface ExtractedFrame {
  data: Buffer;
  mimeType: string;
}

/** PNG rather than JPEG: this frame is an input to further generation, so it should not carry compression artefacts into everything downstream. */
const FRAME_MIME = "image/png";

/**
 * Pulls the first frame out of a local video file.
 *
 * `-frames:v 1` after the input rather than `-vframes 1` before it, so the count applies to the
 * output stream and ffmpeg stops decoding as soon as it has the frame instead of walking the clip.
 */
export async function extractFirstFrame(videoPath: string): Promise<ExtractedFrame> {
  const dir = await mkdtemp(path.join(tmpdir(), "frame-"));
  const outPath = path.join(dir, "frame.png");

  try {
    await execFileAsync(
      FFMPEG_BIN,
      ["-nostdin", "-y", "-i", videoPath, "-frames:v", "1", "-f", "image2", outPath],
      { maxBuffer: 1024 * 1024 * 16 },
    );
    const data = await readFile(outPath);
    if (data.length === 0) throw new Error("ffmpeg produced an empty frame.");
    return { data, mimeType: FRAME_MIME };
  } catch (err) {
    // ffmpeg reports everything on stderr, including the reason a file is unreadable. Losing that
    // to a generic "command failed" is what makes these failures unattributable later.
    const stderr = (err as { stderr?: string }).stderr;
    throw new Error(
      `Could not extract a frame from the clip${stderr ? `: ${stderr.trim().split("\n").slice(-3).join(" ")}` : ""}`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * The same, for a clip that lives at a URL — which is where a Flow mission's output lands.
 *
 * Downloaded first rather than handed to ffmpeg as a URL: ffmpeg would fetch it itself, but then a
 * 404 or an HTML error page becomes a decoder error three layers down instead of the HTTP failure
 * it actually is.
 */
export async function extractFirstFrameFromUrl(url: string): Promise<ExtractedFrame> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download the clip to take a frame from (HTTP ${response.status}).`);
  }

  const dir = await mkdtemp(path.join(tmpdir(), "clip-"));
  const clipPath = path.join(dir, "clip.mp4");
  try {
    await writeFile(clipPath, Buffer.from(await response.arrayBuffer()));
    return await extractFirstFrame(clipPath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
