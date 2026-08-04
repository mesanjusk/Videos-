import type {
  BackgroundInput,
  CharacterPose,
  CharacterSheetInput,
  GenerationAccountContext,
  GeneratedImage,
  ImageProvider,
  SceneImageInput,
  ThumbnailInput,
} from "../../types";
import { getGeminiClient, wrapGeminiError } from "./gemini-client";
import { renderTemplate } from "@/core/prompt-engine/engine";
import { backgroundTemplate, characterTemplate, sceneImageTemplate, thumbnailTemplate } from "@/core/prompt-engine/templates";

const POSES: CharacterPose[] = [
  "front-view",
  "side-view",
  "back-view",
  "45-degree-view",
  "happy",
  "sad",
  "angry",
  "laughing",
  "walking-pose",
  "running-pose",
];

async function generateImage(
  client: ReturnType<typeof getGeminiClient>,
  prompt: string,
  referenceImageUrls: string[] = [],
): Promise<GeneratedImage> {
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: prompt }];

  for (const url of referenceImageUrls) {
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    parts.push({
      inlineData: {
        mimeType: res.headers.get("content-type") ?? "image/png",
        data: buf.toString("base64"),
      },
    });
  }

  const response = await client.models.generateContent({
    model: process.env.GEMINI_IMAGE_MODEL ?? "gemini-3-pro-image",
    contents: [{ role: "user", parts }],
  });

  const imagePart = response.candidates?.[0]?.content?.parts?.find((p) => "inlineData" in p && p.inlineData);
  if (!imagePart || !("inlineData" in imagePart) || !imagePart.inlineData) {
    throw new Error("Gemini did not return image data for this prompt.");
  }

  return {
    data: Buffer.from(imagePart.inlineData.data ?? "", "base64"),
    mimeType: imagePart.inlineData.mimeType ?? "image/png",
    width: 1080,
    height: 1350,
  };
}

export class GeminiImageProvider implements ImageProvider {
  readonly id = "gemini";
  readonly label = "Google Gemini Image Generation";

  async generateCharacterSheet(
    input: CharacterSheetInput,
    account?: GenerationAccountContext,
  ): Promise<Record<CharacterPose, GeneratedImage>> {
    const client = getGeminiClient(account);
    const poses = input.poses.length > 0 ? input.poses : POSES;
    const basePrompt = renderTemplate(input.templateOverride ?? characterTemplate, {
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
    });

    try {
      const entries = await Promise.all(
        poses.map(async (pose) => {
          const image = await generateImage(client, `${basePrompt}\n\nPose for this image: ${pose.replace(/-/g, " ")}.`);
          return [pose, image] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<CharacterPose, GeneratedImage>;
    } catch (err) {
      wrapGeminiError(this.id, err);
    }
  }

  async generateBackground(input: BackgroundInput, account?: GenerationAccountContext): Promise<GeneratedImage> {
    const client = getGeminiClient(account);
    const prompt = renderTemplate(input.templateOverride ?? backgroundTemplate, {
      description: input.description,
      style: input.style,
      lighting: input.lighting,
      aspectRatio: input.aspectRatio,
    });
    try {
      return await generateImage(client, prompt);
    } catch (err) {
      wrapGeminiError(this.id, err);
    }
  }

  async generateSceneImage(input: SceneImageInput, account?: GenerationAccountContext): Promise<GeneratedImage> {
    const client = getGeminiClient(account);
    const prompt = renderTemplate(input.templateOverride ?? sceneImageTemplate, {
      action: input.action,
      cameraAngle: input.cameraAngle,
      emotion: input.emotion,
      lighting: input.lighting,
      style: input.style,
      aspectRatio: input.aspectRatio,
    });
    const refs = [
      ...input.characterReferenceImages.map((r) => r.url),
      ...(input.backgroundReferenceUrl ? [input.backgroundReferenceUrl] : []),
    ];
    try {
      return await generateImage(client, prompt, refs);
    } catch (err) {
      wrapGeminiError(this.id, err);
    }
  }

  async generateThumbnail(input: ThumbnailInput, account?: GenerationAccountContext): Promise<GeneratedImage> {
    const client = getGeminiClient(account);
    const prompt = renderTemplate(input.templateOverride ?? thumbnailTemplate, {
      style: input.style,
      title: input.title,
      aspectRatio: "1080x1920 (9:16)",
    });
    try {
      return await generateImage(
        client,
        prompt,
        input.characterReferenceImages.map((r) => r.url),
      );
    } catch (err) {
      wrapGeminiError(this.id, err);
    }
  }
}
