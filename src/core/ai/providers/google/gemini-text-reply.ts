import type { GenerationAccountContext } from "../../types";
import { getGeminiClient, wrapGeminiError } from "./gemini-client";
import { renderTemplate } from "@/core/prompt-engine/engine";
import { instagramReplyTemplate } from "@/core/prompt-engine/templates/instagram-reply";
import type { PromptTemplateDefinition } from "@/core/prompt-engine/types";

const PROVIDER_ID = "gemini";
/** Instagram DM text has a hard 1000-character limit — clamp defensively rather than let the Send
 * API reject an otherwise-good reply. */
const MAX_REPLY_LENGTH = 1000;

export interface InstagramReplyInput {
  businessName: string;
  incomingMessage: string;
  templateOverride?: PromptTemplateDefinition;
}

/**
 * Drafts an Instagram DM reply via Gemini — not a swappable `core/ai` capability like
 * Story/Image/Voice (there's exactly one call site and no non-Google alternative in scope), but
 * still confined to `core/ai/providers/google` per that directory's "vendor SDK usage lives here
 * only" rule, and still uses the pooled Google Account Manager's quota/rotation via the same
 * `GenerationAccountContext` every other Gemini call takes.
 */
export async function generateInstagramReply(
  input: InstagramReplyInput,
  account?: GenerationAccountContext,
): Promise<string> {
  const prompt = renderTemplate(input.templateOverride ?? instagramReplyTemplate, {
    businessName: input.businessName,
    incomingMessage: input.incomingMessage,
  });

  const client = getGeminiClient(account);
  try {
    const response = await client.models.generateContent({
      model: process.env.GEMINI_TEXT_MODEL ?? "gemini-3.6-flash",
      contents: prompt,
    });

    const text = response.text?.trim();
    if (!text) throw new Error("Gemini returned an empty reply");
    return text.length > MAX_REPLY_LENGTH ? `${text.slice(0, MAX_REPLY_LENGTH - 3)}...` : text;
  } catch (err) {
    wrapGeminiError(PROVIDER_ID, err);
  }
}
