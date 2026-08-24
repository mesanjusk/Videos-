import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VoiceboxProvider } from "./voicebox/voicebox-voice";
import { IdeogramImageProvider } from "./ideogram/ideogram-image";
import { LocalImageProvider } from "./local/local-image";
import { getVoiceProvider, getImageProvider } from "../registry";

const ENV_KEYS = [
  "ENABLE_VOICEBOX", "VOICEBOX_URL",
  "ENABLE_IDEOGRAM", "IDEOGRAM_API_KEY",
  "ENABLE_LOCAL_AI", "LOCAL_AI_IMAGE_URL",
];

beforeEach(() => ENV_KEYS.forEach((k) => delete process.env[k]));
afterEach(() => {
  ENV_KEYS.forEach((k) => delete process.env[k]);
  vi.restoreAllMocks();
});

/**
 * The property every optional provider must hold: unconfigured means *unavailable*, not *broken*.
 * Nothing may throw at import time, nothing may fail a build, and asking for it must produce an
 * error that says what to configure.
 */
describe("optional providers are genuinely optional", () => {
  it("Voicebox is unavailable with no flag and no URL", () => {
    expect(new VoiceboxProvider().isAvailable()).toBe(false);
  });

  it("Voicebox stays unavailable when the flag is on but the URL is missing", () => {
    process.env.ENABLE_VOICEBOX = "true";
    expect(new VoiceboxProvider().isAvailable()).toBe(false);
  });

  it("Voicebox becomes available once both are set", () => {
    process.env.ENABLE_VOICEBOX = "true";
    process.env.VOICEBOX_URL = "http://localhost:8080";
    expect(new VoiceboxProvider().isAvailable()).toBe(true);
  });

  it("Ideogram is unavailable without its key", () => {
    process.env.ENABLE_IDEOGRAM = "true";
    expect(new IdeogramImageProvider().isAvailable()).toBe(false);
  });

  it("the local image worker is unavailable without its URL", () => {
    process.env.ENABLE_LOCAL_AI = "true";
    expect(new LocalImageProvider().isAvailable()).toBe(false);
  });
});

describe("unavailable providers refuse rather than call out", () => {
  it("Voicebox says what to configure instead of making a request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(new VoiceboxProvider().generateVoice({ text: "नमस्ते" })).rejects.toThrow(/VOICEBOX_URL/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("Ideogram does not make a billable call when unconfigured", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      new IdeogramImageProvider().generateThumbnail({ title: "Sehra", characterReferenceImages: [], style: "Pixar" }),
    ).rejects.toThrow(/IDEOGRAM_API_KEY/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the registry refuses an unconfigured provider with an actionable message", () => {
    expect(() => getVoiceProvider("voicebox")).toThrow(/not available for voice/);
    expect(() => getImageProvider("ideogram")).toThrow(/IDEOGRAM_API_KEY/);
  });

  it("still returns the configured default", () => {
    expect(getVoiceProvider("gemini").id).toBe("gemini");
    expect(getImageProvider("gemini").id).toBe("gemini");
  });
});

describe("Ideogram declines what it cannot do well", () => {
  it("refuses character sheets rather than returning ten different people", async () => {
    // It has no reference-image conditioning here, so ten independent generations would not be the
    // same character — which is worse than useless for a pipeline built on character consistency.
    process.env.ENABLE_IDEOGRAM = "true";
    process.env.IDEOGRAM_API_KEY = "test";
    await expect(
      new IdeogramImageProvider().generateCharacterSheet({
        spec: { name: "Asha", style: "Pixar" },
        poses: ["front-view"],
        aspectRatio: "4:5",
      }),
    ).rejects.toThrow(/not the same character|not used for character sheets/);
  });
});

describe("local image worker", () => {
  it("gives one character the same seed every time, so poses have a chance of cohering", async () => {
    process.env.ENABLE_LOCAL_AI = "true";
    process.env.LOCAL_AI_IMAGE_URL = "http://localhost:9000";

    const seeds: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        seeds.push(JSON.parse(init.body).seed);
        return { ok: true, json: async () => ({ imageBase64: "AAA", width: 1080, height: 1350 }) };
      }),
    );

    const provider = new LocalImageProvider();
    await provider.generateCharacterSheet({
      spec: { name: "Asha", style: "Pixar", face: "round" },
      poses: ["front-view", "side-view", "happy"],
      aspectRatio: "4:5",
    });

    expect(new Set(seeds).size).toBe(1);
    expect(seeds[0]).toBeTypeOf("number");
  });

  it("reports the worker's own dimensions when it supplies them", async () => {
    process.env.ENABLE_LOCAL_AI = "true";
    process.env.LOCAL_AI_IMAGE_URL = "http://localhost:9000";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ imageBase64: "AAA", width: 768, height: 960 }) })),
    );

    const image = await new LocalImageProvider().generateBackground({
      description: "a village courtyard",
      category: "village",
      style: "Pixar",
      lighting: "morning",
      aspectRatio: "4:5",
    });
    expect(image).toMatchObject({ width: 768, height: 960, mimeType: "image/png" });
  });

  it("surfaces a worker-reported error instead of returning an empty image", async () => {
    process.env.ENABLE_LOCAL_AI = "true";
    process.env.LOCAL_AI_IMAGE_URL = "http://localhost:9000";
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ error: "CUDA out of memory" }) })));

    await expect(
      new LocalImageProvider().generateBackground({
        description: "x", category: "village", style: "Pixar", lighting: "morning", aspectRatio: "4:5",
      }),
    ).rejects.toThrow(/CUDA out of memory/);
  });
});
