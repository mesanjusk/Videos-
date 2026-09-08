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
// Prompt composition is shared with the Google Flow browser route — see providers/image-prompts.ts
// for why it does not live in here any more.
import {
  DEFAULT_POSES,
  backgroundPrompt,
  characterBasePrompt,
  posePrompt,
  sceneImagePrompt,
  sceneImageReferences,
  thumbnailPrompt,
  thumbnailReferences,
} from "../image-prompts";

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
    model: process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image",
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
    const poses = input.poses.length > 0 ? input.poses : DEFAULT_POSES;
    const basePrompt = characterBasePrompt(input);

    try {
      const entries = await Promise.all(
        poses.map(async (pose) => {
          const image = await generateImage(client, posePrompt(basePrompt, pose));
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
    const prompt = backgroundPrompt(input);
    try {
      return await generateImage(client, prompt);
    } catch (err) {
      wrapGeminiError(this.id, err);
    }
  }

  async generateSceneImage(input: SceneImageInput, account?: GenerationAccountContext): Promise<GeneratedImage> {
    const client = getGeminiClient(account);
    const prompt = sceneImagePrompt(input);
    const refs = sceneImageReferences(input);
    try {
      return await generateImage(client, prompt, refs);
    } catch (err) {
      wrapGeminiError(this.id, err);
    }
  }

  async generateThumbnail(input: ThumbnailInput, account?: GenerationAccountContext): Promise<GeneratedImage> {
    const client = getGeminiClient(account);
    const prompt = thumbnailPrompt(input);
    try {
      return await generateImage(client, prompt, thumbnailReferences(input));
    } catch (err) {
      wrapGeminiError(this.id, err);
    }
  }
}
