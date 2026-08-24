import { FFmpegRenderProvider } from "./ffmpeg-renderer";
import { HybridRenderProvider } from "./hybrid-renderer";
import { isHyperFramesEnabled } from "./hyperframes-renderer";
import { RENDERERS, type RenderProvider, type RendererName } from "./types";

export * from "./types";
export { FFmpegRenderProvider } from "./ffmpeg-renderer";
export { HybridRenderProvider } from "./hybrid-renderer";
export { HyperFramesCompositor, isHyperFramesEnabled } from "./hyperframes-renderer";

/**
 * Resolves the renderer for a production.
 *
 * Defaults to `ffmpeg` — the renderer every existing project has always used. A production profile
 * opts into `hybrid`; asking for `hyperframes` alone resolves to `hybrid`, because HyperFrames
 * composes overlays and does not mux, transcode or mix audio. Pretending otherwise would produce a
 * video with no sound.
 *
 * An unavailable renderer degrades to FFmpeg rather than failing: there is always a renderer.
 */
export function getRenderProvider(requested?: string | null): RenderProvider {
  const name = (RENDERERS as readonly string[]).includes(requested ?? "") ? (requested as RendererName) : "ffmpeg";

  if (name === "ffmpeg") return new FFmpegRenderProvider();

  if (!isHyperFramesEnabled()) {
    console.warn(`[render] renderer "${name}" was requested but ENABLE_HYPERFRAMES is off — using FFmpeg.`);
    return new FFmpegRenderProvider();
  }
  return new HybridRenderProvider();
}
