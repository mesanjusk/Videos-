import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { extractFirstFrame } from "./frame";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = ffmpegPath as unknown as string;

/**
 * These run the real bundled ffmpeg against a real generated clip.
 *
 * Deliberately not mocked. Every other part of the Google Flow path is a guess against a website
 * with no published contract — this is the one link in the chain that can be proved, so it is.
 */
let dir: string;
let clipPath: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "frame-test-"));
  clipPath = path.join(dir, "source.mp4");
  // One second of solid colour at a known size, which is enough to assert the frame is real.
  await execFileAsync(FFMPEG_BIN, [
    "-nostdin", "-y",
    "-f", "lavfi",
    "-i", "color=c=red:s=320x240:d=1:r=10",
    "-pix_fmt", "yuv420p",
    clipPath,
  ]);
}, 60_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
});

describe("extractFirstFrame", () => {
  it("returns a real PNG from a real clip", async () => {
    const frame = await extractFirstFrame(clipPath);

    expect(frame.mimeType).toBe("image/png");
    expect(frame.data.length).toBeGreaterThan(0);
    // PNG magic number — proves ffmpeg wrote an image, not that a file merely exists.
    expect(frame.data.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }, 60_000);

  it("preserves the clip's dimensions in the frame", async () => {
    const frame = await extractFirstFrame(clipPath);
    // PNG IHDR: width and height are big-endian uint32 at byte 16 and 20.
    expect(frame.data.readUInt32BE(16)).toBe(320);
    expect(frame.data.readUInt32BE(20)).toBe(240);
  }, 60_000);

  it("explains itself when the file is not a video", async () => {
    await expect(extractFirstFrame(path.join(dir, "does-not-exist.mp4"))).rejects.toThrow(
      /Could not extract a frame/,
    );
  }, 60_000);
});
