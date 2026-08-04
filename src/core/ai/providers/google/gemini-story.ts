import { Type } from "@google/genai";
import type { GenerationAccountContext, GeneratedStory, StoryGenerationInput, StoryProvider } from "../../types";
import { getGeminiClient, wrapGeminiError } from "./gemini-client";
import { renderTemplate } from "@/core/prompt-engine/engine";
import { storyTemplate } from "@/core/prompt-engine/templates/story";

const STORY_JSON_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    characters: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { name: { type: Type.STRING }, role: { type: Type.STRING } },
        required: ["name", "role"],
      },
    },
    scenes: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          index: { type: Type.INTEGER },
          visual: { type: Type.STRING },
          dialogue: { type: Type.STRING },
          camera: { type: Type.STRING },
          emotion: { type: Type.STRING },
        },
        required: ["index", "visual", "dialogue", "camera", "emotion"],
      },
    },
  },
  required: ["title", "characters", "scenes"],
};

export class GeminiStoryProvider implements StoryProvider {
  readonly id = "gemini";
  readonly label = "Google Gemini";

  async generateStory(input: StoryGenerationInput, account?: GenerationAccountContext): Promise<GeneratedStory> {
    const prompt = renderTemplate(storyTemplate, {
      premise: input.premise,
      language: input.language,
      sceneCount: String(input.sceneCount),
      characterCount: String(input.characterCount),
      tone: input.tone ?? "funny",
      targetDurationSeconds: String(input.targetDurationSeconds ?? 60),
    });

    const client = getGeminiClient(account);
    try {
      const response = await client.models.generateContent({
        model: process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: STORY_JSON_SCHEMA,
        },
      });

      const raw = response.text ?? "{}";
      const parsed = JSON.parse(raw) as {
        title: string;
        characters: { name: string; role: string }[];
        scenes: GeneratedStory["scenes"];
      };

      return {
        title: parsed.title,
        language: input.language,
        characters: parsed.characters,
        scenes: parsed.scenes,
        raw,
      };
    } catch (err) {
      wrapGeminiError(this.id, err);
    }
  }
}
