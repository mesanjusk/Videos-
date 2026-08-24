import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = ffmpegPath as unknown as string;

/**
 * Reads what a media file actually contains.
 *
 * `ffmpeg-static` ships only the `ffmpeg` binary — no `ffprobe` — so everything here comes from
 * parsing `ffmpeg -i`'s stderr, extending the trick `core/ffmpeg/compose.ts` already uses to read a
 * duration. That is less precise than ffprobe's JSON, and the parsers below reflect it: every field
 * is optional, and a field that could not be read comes back `undefined` rather than as a guess.
 *
 * That distinction is load-bearing for the quality checks. "Unknown" must never be treated as
 * "wrong" — a check that fires because a regex did not match would send a perfectly good render
 * back through the most expensive job in the application.
 */

export interface MediaProbe {
  durationSeconds?: number;
  video?: { codec?: string; width?: number; height?: number; fps?: number };
  audio?: { codec?: string; sampleRate?: number; channels?: number };
  /** False only when the file demonstrably has no audio stream, never merely when unparsed. */
  hasAudio: boolean;
  /** True when ffmpeg could not open the file at all — corrupt, truncated, or not media. */
  unreadable: boolean;
  raw: string;
}

/** `ffmpeg -i <file>` with no output always exits non-zero; the information is on stderr. */
async function ffmpegInfo(filePath: string): Promise<string> {
  try {
    const { stderr } = await execFileAsync(FFMPEG_BIN, ["-hide_banner", "-i", filePath], {
      maxBuffer: 1024 * 1024 * 8,
    });
    return stderr;
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? "";
  }
}

export async function probeMedia(filePath: string): Promise<MediaProbe> {
  const raw = await ffmpegInfo(filePath);

  const unreadable =
    raw.length === 0 ||
    /Invalid data found when processing input|No such file or directory|moov atom not found|Invalid argument/i.test(raw);

  const duration = raw.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  const durationSeconds = duration
    ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
    : undefined;

  const videoLine = raw.match(/Stream #\d+:\d+.*: Video: ([^\s,]+).*?, (\d+)x(\d+)[^\n]*/);
  const fpsMatch = videoLine?.[0]?.match(/([\d.]+) fps/);

  const audioLine = raw.match(/Stream #\d+:\d+.*: Audio: ([^\s,]+)[^\n]*/);
  const sampleRateMatch = audioLine?.[0]?.match(/(\d+) Hz/);
  const channelsMatch = audioLine?.[0]?.match(/\b(mono|stereo|(\d+) channels)\b/);

  return {
    durationSeconds,
    video: videoLine
      ? {
          codec: videoLine[1],
          width: Number(videoLine[2]),
          height: Number(videoLine[3]),
          fps: fpsMatch ? Number(fpsMatch[1]) : undefined,
        }
      : undefined,
    audio: audioLine
      ? {
          codec: audioLine[1],
          sampleRate: sampleRateMatch ? Number(sampleRateMatch[1]) : undefined,
          channels: channelsMatch
            ? channelsMatch[1] === "mono"
              ? 1
              : channelsMatch[1] === "stereo"
                ? 2
                : Number(channelsMatch[2])
            : undefined,
        }
      : undefined,
    // Only claim "no audio" when ffmpeg read the file successfully and listed no audio stream.
    hasAudio: !unreadable && !!audioLine,
    unreadable,
    raw,
  };
}

export interface FrameAnomalies {
  /** Ranges, in seconds, where the picture was entirely black. */
  blackRanges: { start: number; end: number }[];
  /** Frames ffmpeg's mpdecimate considered duplicates of their predecessor. */
  duplicateFrames?: number;
  /** True when the analysis itself could not run — the caller must not read absence as "clean". */
  inconclusive: boolean;
}

/**
 * Looks for two failure modes that a duration and resolution check cannot see: a video that
 * rendered as black, and one that froze on a repeated frame. Both are what a broken generation
 * actually looks like — the file is valid, the right length and the right size, and there is
 * nothing in it.
 *
 * A single decode pass over the whole file, so it is not free; the caller decides when to spend it.
 */
export async function detectFrameAnomalies(
  filePath: string,
  options: { minBlackSeconds?: number } = {},
): Promise<FrameAnomalies> {
  const minBlack = options.minBlackSeconds ?? 0.5;
  try {
    const { stderr } = await execFileAsync(
      FFMPEG_BIN,
      [
        "-hide_banner",
        "-i", filePath,
        "-vf", `blackdetect=d=${minBlack}:pix_th=0.10,mpdecimate`,
        "-loglevel", "info",
        "-f", "null",
        "-",
      ],
      { maxBuffer: 1024 * 1024 * 32 },
    ).catch((err) => ({ stderr: (err as { stderr?: string }).stderr ?? "" }));

    const blackRanges = [...stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)/g)].map((m) => ({
      start: Number(m[1]),
      end: Number(m[2]),
    }));

    // mpdecimate reports what it dropped in the final "frame= ... drop=N" summary line.
    const dropMatch = stderr.match(/drop=\s*(\d+)/);

    return {
      blackRanges,
      duplicateFrames: dropMatch ? Number(dropMatch[1]) : undefined,
      inconclusive: stderr.length === 0,
    };
  } catch {
    // An analysis that failed says nothing about the video. Report that honestly rather than
    // returning an empty result that reads as a pass.
    return { blackRanges: [], inconclusive: true };
  }
}
