import type { GenerationAccountContext, GeneratedVoice, VoiceGenerationInput, VoiceProvider } from "../../types";
import { getGeminiClient, wrapGeminiError } from "./gemini-client";
import { renderTemplate } from "@/core/prompt-engine/engine";
import { voiceTemplate } from "@/core/prompt-engine/templates";

/** PDF Step 6 — Voice, via Gemini's native TTS models (approved "Google Gemini (or another free Google service)"). */
export class GeminiVoiceProvider implements VoiceProvider {
  readonly id = "gemini";
  readonly label = "Google Gemini Voice";

  async generateVoice(input: VoiceGenerationInput, account?: GenerationAccountContext): Promise<GeneratedVoice> {
    const client = getGeminiClient(account);
    const prompt = renderTemplate(input.templateOverride ?? voiceTemplate, {
      gender: input.gender ?? "neutral",
      age: String(input.age ?? 12),
      tone: input.tone ?? "cheerful, energetic, funny",
      text: input.text,
    });

    try {
      const response = await client.models.generateContent({
        model: process.env.GEMINI_TTS_MODEL ?? "gemini-2.5-flash-tts",
        contents: prompt,
        config: {
          responseModalities: ["AUDIO"],
        },
      });

      const audioPart = response.candidates?.[0]?.content?.parts?.find((p) => "inlineData" in p && p.inlineData);
      if (!audioPart || !("inlineData" in audioPart) || !audioPart.inlineData) {
        throw new Error("Gemini did not return audio data for this line.");
      }

      return {
        data: Buffer.from(audioPart.inlineData.data ?? "", "base64"),
        mimeType: audioPart.inlineData.mimeType ?? "audio/wav",
      };
    } catch (err) {
      wrapGeminiError(this.id, err);
    }
  }
}
