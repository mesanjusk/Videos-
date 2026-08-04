import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);

// This exact filter-graph structure (xfade transitions, zoompan, per-scene acrossfade narration
// with anullsrc silence fallback, music mix, burned subtitles, optional watermark overlay) was
// hand-verified against synthetic clips before being ported here — see the Stage 5 commit message
// for what was tested. `ffmpeg-static` is required (not `@ffmpeg-installer/ffmpeg`, which pins a
// 2018 build with no `xfade` filter).
const FFMPEG_BIN = ffmpegPath as unknown as string;
const TRANSITION_SECONDS = 0.5;
const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1920;
const OUTPUT_FPS = 30;

export interface ComposeScene {
  index: number;
  videoUrl: string;
  voiceUrl?: string;
  dialogue?: string;
}

export interface ComposeInput {
  scenes: ComposeScene[]; // must be pre-sorted in playback order, at least one entry
  musicUrl?: string;
  watermarkUrl?: string;
}

export interface ComposeResult {
  filePath: string;
  durationSeconds: number;
  cleanup: () => Promise<void>;
}

async function downloadTo(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  await writeFile(destPath, Buffer.from(await res.arrayBuffer()));
}

/** `ffmpeg-static` ships only the `ffmpeg` binary (no `ffprobe`) — duration comes from `-i`'s stderr. */
async function probeDurationSeconds(filePath: string): Promise<number> {
  try {
    await execFileAsync(FFMPEG_BIN, ["-i", filePath]);
    throw new Error("Expected ffmpeg -i with no output to exit non-zero");
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    if (!match) throw new Error(`Could not determine duration of ${filePath}`);
    const [, h, m, s] = match;
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
  }
}

function srtTimestamp(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

/** Runs the full compose pipeline and returns a local file path — caller uploads it and calls `cleanup()`. */
export async function composeVideo(input: ComposeInput): Promise<ComposeResult> {
  if (input.scenes.length === 0) throw new Error("composeVideo requires at least one scene");

  const workDir = await mkdtemp(path.join(tmpdir(), "video-studio-render-"));
  const cleanup = () => rm(workDir, { recursive: true, force: true });

  try {
    const clipPaths = input.scenes.map((_, i) => path.join(workDir, `clip${i}.mp4`));
    const voicePaths: (string | null)[] = input.scenes.map((s, i) => (s.voiceUrl ? path.join(workDir, `voice${i}.mp3`) : null));
    const musicPath = input.musicUrl ? path.join(workDir, "music.mp3") : null;
    const watermarkPath = input.watermarkUrl ? path.join(workDir, "watermark.png") : null;

    await Promise.all([
      ...input.scenes.map((s, i) => downloadTo(s.videoUrl, clipPaths[i]!)),
      ...input.scenes.map((s, i) => (s.voiceUrl ? downloadTo(s.voiceUrl, voicePaths[i]!) : Promise.resolve())),
      input.musicUrl ? downloadTo(input.musicUrl, musicPath!) : Promise.resolve(),
      input.watermarkUrl ? downloadTo(input.watermarkUrl, watermarkPath!) : Promise.resolve(),
    ]);

    const durations = await Promise.all(clipPaths.map((p) => probeDurationSeconds(p)));

    // Cumulative offsets for xfade/acrossfade chaining (each transition overlaps by TRANSITION_SECONDS).
    const offsets: number[] = [0];
    let cumulative = durations[0]!;
    for (let i = 1; i < durations.length; i++) {
      offsets.push(cumulative - TRANSITION_SECONDS);
      cumulative = cumulative + durations[i]! - TRANSITION_SECONDS;
    }
    const totalDuration = cumulative;

    const captionLines = input.scenes
      .map((s, i) => (s.dialogue?.trim() ? { start: offsets[i]!, end: offsets[i]! + durations[i]!, text: s.dialogue.trim() } : null))
      .filter((c): c is { start: number; end: number; text: string } => c !== null);

    let captionsPath: string | null = null;
    if (captionLines.length > 0) {
      const srt = captionLines
        .map((c, i) => `${i + 1}\n${srtTimestamp(c.start)} --> ${srtTimestamp(c.end)}\n${c.text}\n`)
        .join("\n");
      captionsPath = path.join(workDir, "captions.srt");
      await writeFile(captionsPath, srt);
    }

    const inputArgs: string[] = [];
    clipPaths.forEach((p) => inputArgs.push("-i", p));
    const voiceInputIndex: Record<number, number> = {};
    voicePaths.forEach((p, i) => {
      if (p) {
        voiceInputIndex[i] = inputArgs.length / 2;
        inputArgs.push("-i", p);
      }
    });
    let musicInputIndex: number | null = null;
    if (musicPath) {
      musicInputIndex = inputArgs.length / 2;
      inputArgs.push("-stream_loop", "-1", "-i", musicPath);
    }
    let watermarkInputIndex: number | null = null;
    if (watermarkPath) {
      watermarkInputIndex = inputArgs.length / 2;
      inputArgs.push("-i", watermarkPath);
    }

    let filter = "";

    // Per-clip: normalize to portrait output size/framerate, then a gentle Ken Burns zoom.
    input.scenes.forEach((_, i) => {
      filter +=
        `[${i}:v]scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,` +
        `crop=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT},fps=${OUTPUT_FPS},format=yuv420p,` +
        `zoompan=z='min(zoom+0.0008,1.15)':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${OUTPUT_WIDTH}x${OUTPUT_HEIGHT}:fps=${OUTPUT_FPS}[v${i}];\n`;
    });

    // Video transitions: pairwise xfade chain (Join Clips + Transitions).
    if (input.scenes.length === 1) {
      filter += `[v0]null[vout];\n`;
    } else {
      let prevLabel = "v0";
      let running = durations[0]!;
      for (let i = 1; i < input.scenes.length; i++) {
        const outLabel = i === input.scenes.length - 1 ? "vout" : `vx${i}`;
        const offset = running - TRANSITION_SECONDS;
        filter += `[${prevLabel}][v${i}]xfade=transition=fade:duration=${TRANSITION_SECONDS}:offset=${offset.toFixed(3)}[${outLabel}];\n`;
        running = running + durations[i]! - TRANSITION_SECONDS;
        prevLabel = outLabel;
      }
    }

    // Per-clip narration audio: the scene's voice track if present, otherwise exact silence — kept
    // the same length as the clip so the acrossfade chain below stays in sync with the video xfades.
    input.scenes.forEach((s, i) => {
      if (voicePaths[i]) {
        const vi = voiceInputIndex[i];
        filter += `[${vi}:a]atrim=duration=${durations[i]},apad=whole_dur=${durations[i]}[n${i}];\n`;
      } else {
        filter += `anullsrc=channel_layout=stereo:sample_rate=44100:duration=${durations[i]}[n${i}];\n`;
      }
    });

    if (input.scenes.length === 1) {
      filter += `[n0]anull[naout];\n`;
    } else {
      let prevLabel = "n0";
      for (let i = 1; i < input.scenes.length; i++) {
        const outLabel = i === input.scenes.length - 1 ? "naout" : `nax${i}`;
        filter += `[${prevLabel}][n${i}]acrossfade=d=${TRANSITION_SECONDS}[${outLabel}];\n`;
        prevLabel = outLabel;
      }
    }

    // Music bed under the narration (Music).
    let finalAudioLabel = "naout";
    if (musicInputIndex !== null) {
      filter += `[${musicInputIndex}:a]volume=0.2,atrim=duration=${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS[music];\n`;
      filter += `[naout][music]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout];\n`;
      finalAudioLabel = "aout";
    }

    // Captions (burned via libass, since this ffmpeg build has no drawtext).
    let finalVideoLabel = "vout";
    if (captionsPath) {
      filter += `[vout]subtitles=${captionsPath}:force_style='FontSize=28,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,BorderStyle=3,Outline=2,Alignment=2,MarginV=80'[vcap];\n`;
      finalVideoLabel = "vcap";
    }

    // Logo/watermark overlay, bottom-right.
    if (watermarkInputIndex !== null) {
      filter += `[${watermarkInputIndex}:v]scale=150:-1[wm];\n`;
      filter += `[${finalVideoLabel}][wm]overlay=W-w-24:H-h-24[vwm];\n`;
      finalVideoLabel = "vwm";
    }

    const outputPath = path.join(workDir, "final.mp4");
    const args = [
      "-y",
      ...inputArgs,
      "-filter_complex",
      filter,
      "-map",
      `[${finalVideoLabel}]`,
      "-map",
      `[${finalAudioLabel}]`,
      "-r",
      String(OUTPUT_FPS),
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-pix_fmt",
      "yuv420p",
      "-shortest",
      outputPath,
    ];

    await execFileAsync(FFMPEG_BIN, args, { maxBuffer: 1024 * 1024 * 64 });

    return { filePath: outputPath, durationSeconds: totalDuration, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
