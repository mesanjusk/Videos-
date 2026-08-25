import type { GeneratedVoice, VoiceGenerationInput, VoiceProvider } from "@/core/ai/types";
import { getFeatureFlags } from "@/core/config/flags";

/**
 * Voicebox — an optional, self-hosted text-to-speech service.
 *
 * The reason it matters here is not quality, it is that it is the only voice route that costs
 * nothing per call. Gemini TTS bills past its free allowance, which makes it unusable under
 * ZERO_COST (see core/ai/provider-metadata.ts); a self-hosted TTS server is what lets a zero-cost
 * production actually produce narration rather than stopping at the voice stage.
 *
 * ## Optional in the strict sense
 *
 * The application must not depend on Voicebox being installed. With `ENABLE_VOICEBOX` off or
 * `VOICEBOX_URL` unset, `isAvailable()` returns false, the gateway routes elsewhere, and nothing
 * throws. Nothing in this file executes at import time.
 *
 * ## Voice cloning
 *
 * `speaker` selects a voice the operator has already installed on their own server. This provider
 * deliberately exposes no endpoint for *creating* a cloned voice from a sample: cloning someone's
 * voice raises consent questions that belong with whoever operates the server and knows whose
 * voice it is, not with a video pipeline that only knows a speaker id.
 */

export interface VoiceboxOptions {
  baseUrl?: string;
  apiKey?: string;
  defaultSpeaker?: string;
  timeoutMs?: number;
}

interface VoiceboxRequestBody {
  text: string;
  speaker?: string;
  language?: string;
  style?: string;
  format: "mp3";
}

export class VoiceboxProvider implements VoiceProvider {
  readonly id = "voicebox";
  readonly label = "Voicebox (self-hosted TTS)";

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly defaultSpeaker?: string;
  private readonly timeoutMs: number;

  constructor(options: VoiceboxOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.VOICEBOX_URL ?? "").replace(/\/$/, "");
    this.apiKey = options.apiKey ?? process.env.VOICEBOX_API_KEY;
    this.defaultSpeaker = options.defaultSpeaker ?? process.env.VOICEBOX_DEFAULT_SPEAKER;
    this.timeoutMs = options.timeoutMs ?? Number(process.env.VOICEBOX_TIMEOUT_MS ?? 120_000);
  }

  isAvailable(): boolean {
    return getFeatureFlags().voicebox && Boolean(this.baseUrl);
  }

  /** Cheap reachability probe for System Health. Never throws. */
  async health(): Promise<"up" | "down" | "unknown"> {
    if (!this.isAvailable()) return "unknown";
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(`${this.baseUrl}/health`, { headers: this.headers(), signal: controller.signal });
        return res.ok ? "up" : "down";
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return "down";
    }
  }

  /** Speakers the operator has installed. Empty on any failure — this only feeds a UI dropdown. */
  async listSpeakers(): Promise<{ id: string; label: string; language?: string }[]> {
    if (!this.isAvailable()) return [];
    try {
      const res = await fetch(`${this.baseUrl}/speakers`, { headers: this.headers() });
      if (!res.ok) return [];
      const body = (await res.json()) as { speakers?: { id: string; label?: string; language?: string }[] };
      return (body.speakers ?? []).map((s) => ({ id: s.id, label: s.label ?? s.id, language: s.language }));
    } catch {
      return [];
    }
  }

  async generateVoice(input: VoiceGenerationInput): Promise<GeneratedVoice> {
    if (!this.isAvailable()) {
      throw new Error(
        "Voicebox is not available — set ENABLE_VOICEBOX=true and VOICEBOX_URL, or route voice to another provider.",
      );
    }

    const body: VoiceboxRequestBody = {
      text: input.text,
      speaker: this.speakerFor(input),
      language: process.env.VOICEBOX_DEFAULT_LANGUAGE,
      // Passed through only when the caller asked for one — a server that does not support styles
      // should not receive a field it has to reject.
      style: input.tone,
      format: "mp3",
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/tts`, {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Voicebox returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
      }

      const audio = Buffer.from(await response.arrayBuffer());
      if (audio.byteLength === 0) throw new Error("Voicebox returned an empty audio response.");

      // Duration comes from a header when the server reports one. It is not guessed from byte
      // length: an MP3's bitrate is not knowable from the buffer alone, and the quality checks
      // would then be validating an invented number.
      const reported = response.headers.get("x-audio-duration-seconds");
      const durationSeconds = reported ? Number(reported) : undefined;

      return {
        data: audio,
        mimeType: "audio/mpeg",
        durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** A per-character voice, if the caller named one, else the deployment default. */
  private speakerFor(input: VoiceGenerationInput): string | undefined {
    const perCharacter = input.characterName
      ? process.env[`VOICEBOX_SPEAKER_${input.characterName.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`]
      : undefined;
    return perCharacter ?? this.defaultSpeaker;
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }
}
