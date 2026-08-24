import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { getFeatureFlags } from "@/core/config/flags";
import type { RenderOverlay } from "./types";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = ffmpegPath as unknown as string;

/**
 * HTML/CSS motion-graphics compositing — the "HyperFrames" renderer slot.
 *
 * ## What this actually is, stated plainly
 *
 * The capability being filled is: take timed HTML/CSS overlays — animated titles, lower thirds,
 * captions, charts — and turn them into video that can be laid over the FFmpeg composition. There
 * are two backends:
 *
 *  1. **An external HyperFrames-compatible service**, if `HYPERFRAMES_URL` is set. POST the
 *     overlay set, get a transparent overlay video back. Documented in docs/RENDERING.md.
 *  2. **The built-in compositor**, otherwise: headless Chromium (Playwright, already a dependency)
 *     screenshots each overlay across its time range, and FFmpeg encodes the frames into a
 *     transparent WebM.
 *
 * The second is not a stub and not a claim to be someone else's renderer — it is a working local
 * implementation of the same capability, written here because it needs nothing installed beyond
 * what the worker already has for browser automation. An operator who runs the real HyperFrames
 * points `HYPERFRAMES_URL` at it and gets that instead.
 *
 * ## What it does not do
 *
 * Muxing, transcoding, audio mixing, concatenation and the final encode all stay with FFmpeg. This
 * produces one overlay track; `hybrid-renderer.ts` is what combines the two.
 *
 * Runs in the worker only — it drives Chromium, so it is subject to the same rule as everything
 * else that does.
 */

const DEFAULT_FPS = 30;

export interface HyperFramesOptions {
  serviceUrl?: string;
  width?: number;
  height?: number;
  fps?: number;
}

export function isHyperFramesEnabled(): boolean {
  return getFeatureFlags().hyperframes;
}

export interface OverlayTrack {
  /** Transparent overlay video covering the full composition duration. */
  filePath: string;
  cleanup: () => Promise<void>;
}

export class HyperFramesCompositor {
  private readonly serviceUrl?: string;
  private readonly width: number;
  private readonly height: number;
  private readonly fps: number;

  constructor(options: HyperFramesOptions = {}) {
    this.serviceUrl = options.serviceUrl ?? process.env.HYPERFRAMES_URL;
    this.width = options.width ?? 1080;
    this.height = options.height ?? 1920;
    this.fps = options.fps ?? Number(process.env.HYPERFRAMES_FPS ?? DEFAULT_FPS);
  }

  /**
   * Renders the overlays into one transparent video of `durationSeconds`.
   *
   * Returns null when there is nothing to do, so the caller can skip the extra FFmpeg pass
   * entirely rather than muxing an empty track over the composition.
   */
  async composeOverlayTrack(overlays: RenderOverlay[], durationSeconds: number): Promise<OverlayTrack | null> {
    if (overlays.length === 0) return null;
    if (this.serviceUrl) return this.composeViaService(overlays, durationSeconds);
    return this.composeLocally(overlays, durationSeconds);
  }

  private async composeViaService(overlays: RenderOverlay[], durationSeconds: number): Promise<OverlayTrack> {
    const workDir = await mkdtemp(path.join(tmpdir(), "hyperframes-"));
    const cleanup = () => rm(workDir, { recursive: true, force: true });
    try {
      const response = await fetch(`${this.serviceUrl!.replace(/\/$/, "")}/compose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          width: this.width,
          height: this.height,
          fps: this.fps,
          durationSeconds,
          overlays,
          format: "webm",
          transparent: true,
        }),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`HyperFrames service returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
      }
      const filePath = path.join(workDir, "overlay.webm");
      await writeFile(filePath, Buffer.from(await response.arrayBuffer()));
      return { filePath, cleanup };
    } catch (err) {
      await cleanup();
      throw err;
    }
  }

  /**
   * Frame-by-frame capture in headless Chromium.
   *
   * Each overlay is rendered on a transparent page and screenshotted once per frame across its own
   * time range, with `--elapsed` exposed to the page's CSS as a custom property so an animation can
   * be driven deterministically rather than by wall-clock time. Deterministic is the point: two
   * runs of the same overlay must produce the same frames, which real-time capture would not
   * guarantee.
   */
  private async composeLocally(overlays: RenderOverlay[], durationSeconds: number): Promise<OverlayTrack> {
    const workDir = await mkdtemp(path.join(tmpdir(), "hyperframes-"));
    const cleanup = () => rm(workDir, { recursive: true, force: true });

    try {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({
          viewport: { width: this.width, height: this.height },
          deviceScaleFactor: 1,
        });

        const totalFrames = Math.max(1, Math.ceil(durationSeconds * this.fps));
        const framesDir = path.join(workDir, "frames");
        await execFileAsync("mkdir", ["-p", framesDir]);

        for (let frame = 0; frame < totalFrames; frame += 1) {
          const t = frame / this.fps;
          const active = overlays.filter((o) => t >= o.startSeconds && t < o.endSeconds);
          await page.setContent(this.buildFrameHtml(active, t), { waitUntil: "load" });
          await page.screenshot({
            path: path.join(framesDir, `frame-${String(frame).padStart(6, "0")}.png`),
            omitBackground: true, // transparency is the whole point of an overlay track
          });
        }

        const filePath = path.join(workDir, "overlay.webm");
        await execFileAsync(
          FFMPEG_BIN,
          [
            "-y",
            "-framerate", String(this.fps),
            "-i", path.join(framesDir, "frame-%06d.png"),
            // VP9 with yuva420p is the combination that actually preserves alpha; libx264 does not.
            "-c:v", "libvpx-vp9",
            "-pix_fmt", "yuva420p",
            "-b:v", "2M",
            filePath,
          ],
          { maxBuffer: 1024 * 1024 * 64 },
        );

        return { filePath, cleanup };
      } finally {
        await browser.close();
      }
    } catch (err) {
      await cleanup();
      throw err;
    }
  }

  /**
   * Builds one frame's page. Everything is inline — no external stylesheet, font or image request —
   * because the renderer runs offline and a page that waits on the network would stall the capture
   * and produce a blank frame.
   */
  private buildFrameHtml(active: RenderOverlay[], elapsedSeconds: number): string {
    const blocks = active
      .map((overlay) => {
        const local = elapsedSeconds - overlay.startSeconds;
        const duration = Math.max(0.001, overlay.endSeconds - overlay.startSeconds);
        return `<div class="hf-overlay hf-${escapeAttribute(overlay.kind)}" data-id="${escapeAttribute(overlay.id)}"
          style="--elapsed:${local.toFixed(4)}s; --duration:${duration.toFixed(4)}s; --progress:${(local / duration).toFixed(6)};">
          ${overlay.css ? `<style>${overlay.css}</style>` : ""}
          ${overlay.html}
        </div>`;
      })
      .join("\n");

    return `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;width:${this.width}px;height:${this.height}px;background:transparent;overflow:hidden;}
      .hf-overlay{position:absolute;inset:0;}
      /* Animations are positioned by --progress rather than played, so capture is deterministic. */
      *{animation-play-state:paused !important;}
    </style></head><body>${blocks}</body></html>`;
  }
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
