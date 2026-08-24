import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getRenderProvider, FFmpegRenderProvider, HybridRenderProvider } from "./index";

beforeEach(() => delete process.env.ENABLE_HYPERFRAMES);
afterEach(() => delete process.env.ENABLE_HYPERFRAMES);

describe("getRenderProvider", () => {
  it("defaults to FFmpeg, which is what every existing project already renders with", () => {
    expect(getRenderProvider()).toBeInstanceOf(FFmpegRenderProvider);
  });

  it("ignores an unrecognised renderer name rather than failing a render", () => {
    expect(getRenderProvider("blender")).toBeInstanceOf(FFmpegRenderProvider);
  });

  it("degrades to FFmpeg when hybrid is requested but HyperFrames is switched off", () => {
    expect(getRenderProvider("hybrid")).toBeInstanceOf(FFmpegRenderProvider);
  });

  it("returns the hybrid renderer once HyperFrames is enabled", () => {
    process.env.ENABLE_HYPERFRAMES = "true";
    expect(getRenderProvider("hybrid")).toBeInstanceOf(HybridRenderProvider);
  });

  it("resolves a bare hyperframes request to hybrid, because HyperFrames alone cannot mux audio", () => {
    process.env.ENABLE_HYPERFRAMES = "true";
    const provider = getRenderProvider("hyperframes");
    expect(provider).toBeInstanceOf(HybridRenderProvider);
    expect(provider.capabilities.audioMixing).toBe(true);
  });

  it("declares honestly that FFmpeg cannot compose HTML overlays", () => {
    expect(new FFmpegRenderProvider().capabilities.htmlOverlays).toBe(false);
  });

  it("keeps FFmpeg always available, so a ZERO_COST render always has a renderer", () => {
    expect(new FFmpegRenderProvider().isAvailable()).toBe(true);
  });
});
