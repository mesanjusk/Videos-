import { composeVideo } from "@/core/ffmpeg/compose";
import type { RenderProvider, RenderRequest, RenderResult } from "./types";

/**
 * FFmpeg, behind the RenderProvider interface.
 *
 * A thin adapter and nothing more — `core/ffmpeg/compose.ts` is not modified by this merge, and
 * this class exists so that adding a second renderer did not require touching it. It is always
 * available (the binary ships with `ffmpeg-static`), needs no configuration and costs nothing,
 * which makes it the renderer a ZERO_COST production always has.
 */
export class FFmpegRenderProvider implements RenderProvider {
  readonly name = "ffmpeg" as const;
  readonly capabilities = { htmlOverlays: false, muxing: true, transcoding: true, audioMixing: true };

  isAvailable(): boolean {
    return true;
  }

  async render(request: RenderRequest): Promise<RenderResult> {
    const warnings: string[] = [];
    if (request.overlays?.length) {
      // Said out loud rather than dropped. FFmpeg burns the dialogue subtitles compose.ts builds,
      // but it cannot render an arbitrary HTML overlay — that is what the hybrid renderer is for.
      warnings.push(
        `${request.overlays.length} HTML overlay(s) were not rendered: the FFmpeg renderer cannot compose HTML. ` +
          "Use renderer=hybrid to have HyperFrames compose them first.",
      );
    }

    const result = await composeVideo({
      scenes: request.scenes,
      musicUrl: request.musicUrl,
      watermarkUrl: request.watermarkUrl,
    });

    return { ...result, renderer: "ffmpeg", warnings };
  }
}
