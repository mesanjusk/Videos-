import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { FFmpegRenderProvider } from "./ffmpeg-renderer";
import { HyperFramesCompositor, isHyperFramesEnabled } from "./hyperframes-renderer";
import type { RenderProvider, RenderRequest, RenderResult } from "./types";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = ffmpegPath as unknown as string;

/**
 * The renderer worth using when there are overlays: each tool doing what it is best at.
 *
 * FFmpeg composes the base video exactly as it always has — untouched filter graph, same xfade
 * chain, same audio handling. HyperFrames composes the HTML overlays into a transparent track.
 * One final FFmpeg pass lays the second over the first.
 *
 * That last pass is the only new FFmpeg invocation the merge adds, and it is deliberately trivial:
 * a single `overlay` filter and a stream copy of the audio. Nothing about the base composition is
 * re-encoded beyond what the overlay requires, and `core/ffmpeg/compose.ts` is not touched.
 *
 * **Degrades rather than fails.** No overlays, HyperFrames disabled, or the overlay pass itself
 * failing all produce the FFmpeg-only result with a warning attached — a title card that did not
 * render is not a reason to lose the video.
 */
export class HybridRenderProvider implements RenderProvider {
  readonly name = "hybrid" as const;
  readonly capabilities = { htmlOverlays: true, muxing: true, transcoding: true, audioMixing: true };

  private readonly ffmpeg = new FFmpegRenderProvider();

  isAvailable(): boolean {
    return true; // worst case it is FFmpeg, which is always available
  }

  async render(request: RenderRequest): Promise<RenderResult> {
    const base = await this.ffmpeg.render({ ...request, overlays: undefined });
    const warnings = [...base.warnings];

    const overlays = request.overlays ?? [];
    if (overlays.length === 0) return { ...base, renderer: "hybrid", warnings };

    if (!isHyperFramesEnabled()) {
      warnings.push(
        `${overlays.length} HTML overlay(s) were skipped: ENABLE_HYPERFRAMES is off. The video was rendered with FFmpeg alone.`,
      );
      return { ...base, renderer: "ffmpeg", warnings };
    }

    const compositor = new HyperFramesCompositor({ width: request.width, height: request.height, fps: request.fps });
    let track: Awaited<ReturnType<HyperFramesCompositor["composeOverlayTrack"]>> = null;
    const workDir = await mkdtemp(path.join(tmpdir(), "hybrid-render-"));

    try {
      track = await compositor.composeOverlayTrack(overlays, base.durationSeconds);
      if (!track) return { ...base, renderer: "hybrid", warnings };

      const outputPath = path.join(workDir, "final.mp4");
      await execFileAsync(
        FFMPEG_BIN,
        [
          "-y",
          "-i", base.filePath,
          "-i", track.filePath,
          "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto[v]",
          "-map", "[v]",
          "-map", "0:a?",
          "-c:v", "libx264",
          "-c:a", "copy",
          "-pix_fmt", "yuv420p",
          "-shortest",
          outputPath,
        ],
        { maxBuffer: 1024 * 1024 * 64 },
      );

      const baseCleanup = base.cleanup;
      const trackCleanup = track.cleanup;
      return {
        filePath: outputPath,
        durationSeconds: base.durationSeconds,
        renderer: "hybrid",
        warnings,
        cleanup: async () => {
          await Promise.allSettled([baseCleanup(), trackCleanup(), rm(workDir, { recursive: true, force: true })]);
        },
      };
    } catch (err) {
      // The base video is finished and good. Losing it because a lower third failed to composite
      // would be the wrong trade every time.
      await track?.cleanup().catch(() => {});
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
      warnings.push(
        `HTML overlays were not applied (${err instanceof Error ? err.message : String(err)}). ` +
          "The FFmpeg-composed video is unaffected.",
      );
      return { ...base, renderer: "ffmpeg", warnings };
    }
  }
}
