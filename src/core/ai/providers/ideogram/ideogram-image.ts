import type {
  BackgroundInput,
  CharacterPose,
  CharacterSheetInput,
  GeneratedImage,
  ImageProvider,
  SceneImageInput,
  ThumbnailInput,
} from "@/core/ai/types";
import { getFeatureFlags } from "@/core/config/flags";
import { renderTemplate } from "@/core/prompt-engine/engine";
import { backgroundTemplate, sceneImageTemplate, thumbnailTemplate } from "@/core/prompt-engine/templates";

/**
 * Ideogram — an optional image provider, added specifically for the one thing it is markedly better
 * at than a general image model: **text inside the image**. Title cards, posters, thumbnails,
 * invitation-style graphics, anything where a mangled word ruins the frame.
 *
 * It is not a replacement for the default image provider and is not wired in as one. A production
 * profile opts into it per capability; everything else keeps using whatever it used.
 *
 * **Paid, and therefore never reachable under ZERO_COST.** `core/ai/provider-metadata.ts`
 * classifies it `paid` and the gateway filters it out before this class is ever constructed — but
 * `generateImage` re-checks availability anyway, so a caller that bypasses the gateway still cannot
 * make a billable call from an unconfigured deployment.
 *
 * With `ENABLE_IDEOGRAM` off or `IDEOGRAM_API_KEY` unset the provider simply reports unavailable.
 */

const API_BASE = "https://api.ideogram.ai";

export interface IdeogramOptions {
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

/** Ideogram takes an aspect ratio string, not pixel dimensions. */
function aspectRatioFor(ratio: string): string {
  switch (ratio) {
    case "4:5":
      return "ASPECT_4_5";
    case "9:16":
      return "ASPECT_9_16";
    case "16:9":
      return "ASPECT_16_9";
    case "1:1":
      return "ASPECT_1_1";
    default:
      return "ASPECT_4_5";
  }
}

export class IdeogramImageProvider implements ImageProvider {
  readonly id = "ideogram";
  readonly label = "Ideogram";

  private readonly apiKey?: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: IdeogramOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.IDEOGRAM_API_KEY;
    this.model = options.model ?? process.env.IDEOGRAM_MODEL ?? "V_2";
    this.timeoutMs = options.timeoutMs ?? Number(process.env.IDEOGRAM_TIMEOUT_MS ?? 120_000);
  }

  isAvailable(): boolean {
    return getFeatureFlags().ideogram && Boolean(this.apiKey);
  }

  async generateCharacterSheet(input: CharacterSheetInput): Promise<Record<CharacterPose, GeneratedImage>> {
    // Character sheets need the same face across ten poses. Ideogram has no image-reference
    // conditioning in this integration, so ten independent generations would produce ten different
    // people — worse than useless for a pipeline whose whole point is character consistency.
    // Refusing is the honest answer; the default image provider handles character sheets.
    void input;
    throw new Error(
      "Ideogram is not used for character sheets: it has no reference-image conditioning here, so the poses " +
        "would not be the same character. Use it for text-heavy stills (titles, posters, thumbnails) instead.",
    );
  }

  async generateBackground(input: BackgroundInput): Promise<GeneratedImage> {
    const prompt = renderTemplate(input.templateOverride ?? backgroundTemplate, {
      description: input.description,
      style: input.style,
      lighting: input.lighting,
      aspectRatio: input.aspectRatio,
    });
    return this.generate(prompt, input.aspectRatio);
  }

  async generateSceneImage(input: SceneImageInput): Promise<GeneratedImage> {
    const prompt = renderTemplate(input.templateOverride ?? sceneImageTemplate, {
      action: input.action,
      cameraAngle: input.cameraAngle,
      emotion: input.emotion,
      lighting: input.lighting,
      style: input.style,
      aspectRatio: input.aspectRatio,
    });
    return this.generate(prompt, input.aspectRatio);
  }

  async generateThumbnail(input: ThumbnailInput): Promise<GeneratedImage> {
    // The case Ideogram is here for — a thumbnail is mostly a title.
    const prompt = renderTemplate(input.templateOverride ?? thumbnailTemplate, {
      style: input.style,
      title: input.title,
      aspectRatio: "1080x1920 (9:16)",
    });
    return this.generate(prompt, "4:5");
  }

  private async generate(prompt: string, aspectRatio: string): Promise<GeneratedImage> {
    if (!this.isAvailable()) {
      throw new Error(
        "Ideogram is not available — set ENABLE_IDEOGRAM=true and IDEOGRAM_API_KEY, or route images elsewhere.",
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${API_BASE}/generate`, {
        method: "POST",
        headers: { "Api-Key": this.apiKey!, "Content-Type": "application/json" },
        body: JSON.stringify({
          image_request: { prompt, model: this.model, aspect_ratio: aspectRatioFor(aspectRatio), magic_prompt_option: "AUTO" },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Ideogram returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
      }

      const body = (await response.json()) as { data?: { url?: string }[] };
      const url = body.data?.[0]?.url;
      if (!url) throw new Error("Ideogram returned no image URL.");

      // The URL is handed straight back; the caller uploads it through the storage abstraction,
      // which is also where the real dimensions get measured. Reporting invented width/height here
      // would defeat core/quality/checks.ts, which deliberately validates measured values.
      return { data: url, mimeType: "image/png", width: 0, height: 0 };
    } finally {
      clearTimeout(timer);
    }
  }
}
