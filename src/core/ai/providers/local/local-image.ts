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
import { backgroundTemplate, characterTemplate, sceneImageTemplate, thumbnailTemplate } from "@/core/prompt-engine/templates";

/**
 * An image provider backed by a local generation service over HTTP.
 *
 * ## Why an HTTP contract rather than an integration
 *
 * Easy Diffusion, AUTOMATIC1111, ComfyUI, SD.Next and a dozen others all generate images locally
 * and none of them agree on an API. Building any one of them into this application would mean
 * shipping that project's assumptions — its model layout, its GPU requirements, its Python
 * environment — into a Next.js app that must also deploy to Vercel.
 *
 * So the contract is deliberately small and generic: POST a prompt, get bytes or a URL back. A
 * ten-line adapter in front of whichever tool an operator already runs satisfies it, and this
 * application stays free of GPU and Python concerns entirely. `docs/PROVIDERS.md` documents the
 * exact request and response shape.
 *
 * ## Why it matters
 *
 * This is the only image route classified genuinely free, so it is the only one a ZERO_COST
 * production can use. Without it, a zero-cost run stops at the first image.
 */

export interface LocalImageOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

interface LocalImageResponse {
  /** Either raw base64 image data, or a URL the caller can fetch. Exactly one is required. */
  imageBase64?: string;
  imageUrl?: string;
  width?: number;
  height?: number;
  error?: string;
}

function dimensionsFor(aspectRatio: string): { width: number; height: number } {
  switch (aspectRatio) {
    case "9:16":
      return { width: 1080, height: 1920 };
    case "16:9":
      return { width: 1920, height: 1080 };
    case "1:1":
      return { width: 1080, height: 1080 };
    case "4:5":
    default:
      return { width: 1080, height: 1350 };
  }
}

export class LocalImageProvider implements ImageProvider {
  readonly id = "local-image";
  readonly label = "Local image worker";

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(options: LocalImageOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.LOCAL_AI_IMAGE_URL ?? "").replace(/\/$/, "");
    this.apiKey = options.apiKey ?? process.env.LOCAL_AI_IMAGE_API_KEY;
    this.timeoutMs = options.timeoutMs ?? Number(process.env.LOCAL_AI_IMAGE_TIMEOUT_MS ?? 300_000);
  }

  isAvailable(): boolean {
    return getFeatureFlags().localAi && Boolean(this.baseUrl);
  }

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

  /**
   * Generates each pose as its own request, threading the same seed and character description
   * through. Honest limitation: without reference-image conditioning this gives *related* images,
   * not guaranteed identity. The existing perceptual-hash consistency check
   * (core/quality/perceptual-hash.ts) is what catches a pose that drifted too far, and it applies
   * to this provider exactly as it does to any other.
   */
  async generateCharacterSheet(input: CharacterSheetInput): Promise<Record<CharacterPose, GeneratedImage>> {
    const { width, height } = dimensionsFor(input.aspectRatio);
    // A stable seed per character is what gives the poses any chance of cohering.
    const seed = hashToSeed(`${input.spec.name}|${input.spec.style}|${input.spec.face ?? ""}`);

    const entries = await Promise.all(
      input.poses.map(async (pose) => {
        const prompt = `${renderTemplate(input.templateOverride ?? characterTemplate, {
          style: input.spec.style,
          age: input.spec.age ?? "",
          bodyType: input.spec.bodyType ?? "",
          face: input.spec.face ?? "",
          eyes: input.spec.eyes ?? "",
          hair: input.spec.hair ?? "",
          clothes: input.spec.clothes ?? "",
          shoes: input.spec.shoes ?? "",
          accessories: input.spec.accessories ?? "",
          personality: input.spec.personality ?? "",
          aspectRatio: input.aspectRatio,
        })}\n\nPose for this image: ${pose.replace(/-/g, " ")}.`;
        return [pose, await this.generate(prompt, width, height, seed)] as const;
      }),
    );

    return Object.fromEntries(entries) as Record<CharacterPose, GeneratedImage>;
  }

  async generateBackground(input: BackgroundInput): Promise<GeneratedImage> {
    const { width, height } = dimensionsFor(input.aspectRatio);
    const prompt = renderTemplate(input.templateOverride ?? backgroundTemplate, {
      description: input.description,
      style: input.style,
      lighting: input.lighting,
      aspectRatio: input.aspectRatio,
    });
    return this.generate(prompt, width, height);
  }

  async generateSceneImage(input: SceneImageInput): Promise<GeneratedImage> {
    const { width, height } = dimensionsFor(input.aspectRatio);
    const prompt = renderTemplate(input.templateOverride ?? sceneImageTemplate, {
      action: input.action,
      cameraAngle: input.cameraAngle,
      emotion: input.emotion,
      lighting: input.lighting,
      style: input.style,
      aspectRatio: input.aspectRatio,
    });
    return this.generate(prompt, width, height);
  }

  async generateThumbnail(input: ThumbnailInput): Promise<GeneratedImage> {
    const { width, height } = dimensionsFor("4:5");
    const prompt = renderTemplate(input.templateOverride ?? thumbnailTemplate, {
      style: input.style,
      title: input.title,
      aspectRatio: "1080x1920 (9:16)",
    });
    return this.generate(prompt, width, height);
  }

  private async generate(prompt: string, width: number, height: number, seed?: number): Promise<GeneratedImage> {
    if (!this.isAvailable()) {
      throw new Error(
        "The local image worker is not available — set ENABLE_LOCAL_AI=true and LOCAL_AI_IMAGE_URL, " +
          "or route images to another provider.",
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/generate`, {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, width, height, seed, format: "png" }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Local image worker returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
      }

      const body = (await response.json()) as LocalImageResponse;
      if (body.error) throw new Error(`Local image worker reported: ${body.error}`);

      const data = body.imageBase64 ?? body.imageUrl;
      if (!data) throw new Error("Local image worker returned neither imageBase64 nor imageUrl.");

      // Requested dimensions are echoed back only when the worker confirms them. Where it does
      // not, they are left at the request values and the storage layer measures the real ones —
      // the quality checks validate the measurement, never this claim.
      return { data, mimeType: "image/png", width: body.width ?? width, height: body.height ?? height };
    } finally {
      clearTimeout(timer);
    }
  }

  private headers(): Record<string, string> {
    return this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
  }
}

/** Deterministic 31-bit seed from a string, so the same character always gets the same seed. */
function hashToSeed(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}
