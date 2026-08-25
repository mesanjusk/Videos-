/**
 * Rendering provider abstraction.
 *
 * The rule this exists to respect: **FFmpeg is not replaced.** `core/ffmpeg/compose.ts` is a
 * hand-tuned filter graph — xfade chains, per-scene narration padded with silence so the audio
 * crossfades stay aligned with the video ones, a music bed, burned subtitles through libass because
 * the bundled build has no drawtext — and it was verified against real clips. Nothing here edits
 * that file; `FFmpegRenderProvider` calls it.
 *
 * HyperFrames is added *alongside*, for the class of work FFmpeg is genuinely awkward at: animated
 * text, lower thirds, charts, anything that is really a web page moving. The two are not
 * alternatives so much as different tools, which is why `hybrid` is the interesting mode: compose
 * the motion graphics as HTML, then hand them to FFmpeg for muxing, transcoding, audio mixing and
 * the final encode — the things it is best in the world at.
 */

export const RENDERERS = ["ffmpeg", "hyperframes", "hybrid"] as const;
export type RendererName = (typeof RENDERERS)[number];

export interface RenderScene {
  index: number;
  videoUrl: string;
  voiceUrl?: string;
  dialogue?: string;
  /** True when the clip's own audio already carries the narration (a lip-synced clip). */
  useEmbeddedAudio?: boolean;
}

export interface RenderRequest {
  scenes: RenderScene[];
  musicUrl?: string;
  watermarkUrl?: string;
  /** Overlays composed by an HTML renderer, ignored by a renderer that cannot do them. */
  overlays?: RenderOverlay[];
  width?: number;
  height?: number;
  fps?: number;
}

/** A timed HTML/CSS overlay — the thing HyperFrames exists for. */
export interface RenderOverlay {
  id: string;
  kind: "caption" | "lower-third" | "title-card" | "chart" | "custom";
  /** Self-contained HTML. No external requests: the renderer runs it offline. */
  html: string;
  css?: string;
  startSeconds: number;
  endSeconds: number;
}

export interface RenderResult {
  filePath: string;
  durationSeconds: number;
  /** Which renderer actually produced it, after any degrade. */
  renderer: RendererName;
  /** Anything the renderer chose not to do and why — never silently dropped. */
  warnings: string[];
  cleanup: () => Promise<void>;
}

export interface RenderProvider {
  readonly name: RendererName;
  /** Whether this renderer can run here — binary present, flag on, dependencies installed. */
  isAvailable(): boolean;
  /** What it can do, so the composer knows whether to route overlays to it. */
  readonly capabilities: { htmlOverlays: boolean; muxing: boolean; transcoding: boolean; audioMixing: boolean };
  render(request: RenderRequest): Promise<RenderResult>;
}
