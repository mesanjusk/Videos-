import { getGeminiClient, wrapGeminiError } from "@/core/ai/providers/google/gemini-client";
import { GEMINI_REQUIREMENT } from "@/core/ai/provider-metadata";
import type { GenerationAccountContext } from "@/core/ai/types";
import { OmniRouteClient } from "./omniroute";
import { aiGateway, type ExecutionOutcome } from "./gateway";

/**
 * Free-form text completion, routed by capability rather than by vendor.
 *
 * The existing `StoryProvider` interface is shaped for one job — produce a story with characters
 * and scenes — which is right for what it does and wrong for everything else that needs an LLM.
 * The Production Director plans, the research stage summarises, the fact-check stage critiques;
 * none of those is a story. This is the general text route those use.
 *
 * It goes through the same `AiGateway`, so the cost policy applies identically: under ZERO_COST
 * only a local LLM is reachable, and if none is configured the call fails saying so rather than
 * quietly using a metered API.
 */

export interface TextRequest {
  system?: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  /** Ask the provider for JSON. Best-effort — the caller must still parse defensively. */
  json?: boolean;
  costPolicy?: string | null;
  preferredProviderId?: string | null;
  /**
   * A pooled Google account resolved by the caller (modules/accounts#resolveGenerationAccount).
   *
   * Every other Gemini path in this codebase takes one; this route did not, so it could only ever
   * authenticate from `GEMINI_API_KEY` — the local-dev fallback. On a deployment that keeps its
   * keys on connected accounts, that made Gemini unusable *and* unavailable: the gateway rules a
   * provider out on its missing requirement, so a Director run failed with "no provider for story"
   * while the story stage, which does pass an account, worked fine.
   */
  account?: GenerationAccountContext;
}

export interface TextResponse {
  text: string;
  providerId: string;
  model?: string;
}

export async function generateText(request: TextRequest): Promise<TextResponse> {
  const outcome: ExecutionOutcome<{ text: string; model?: string }> = await aiGateway.execute(
    "story",
    {
      costPolicy: request.costPolicy,
      preferredProviderId: request.preferredProviderId,
      // The account's own key stands in for the env var Gemini declares as its requirement.
      suppliedRequirements: request.account?.apiKey ? [GEMINI_REQUIREMENT] : [],
    },
    async (descriptor) => {
      switch (descriptor.id) {
        case "local-llm":
          return callOpenAiCompatible(process.env.LOCAL_AI_LLM_URL!, process.env.LOCAL_AI_LLM_API_KEY, request);
        case "omniroute": {
          const client = new OmniRouteClient();
          const completion = await client.complete({
            messages: messagesFor(request),
            temperature: request.temperature,
            maxTokens: request.maxTokens,
          });
          return { text: completion.text, model: completion.model };
        }
        case "gemini":
          return callGemini(request);
        default:
          throw new Error(`No text route implemented for provider "${descriptor.id}"`);
      }
    },
  );

  return { text: outcome.result.text, providerId: outcome.providerId, model: outcome.result.model };
}

/**
 * Parses a JSON object out of a model response.
 *
 * Models wrap JSON in prose and fenced code blocks even when told not to, so this strips a fence
 * and falls back to the outermost brace pair before giving up. It throws rather than returning a
 * partial object — a Director plan that silently lost half its fields is worse than a failed job.
 */
export function parseJsonResponse<T>(text: string): T {
  const withoutFence = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const candidates = [withoutFence, text];

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      const start = candidate.indexOf("{");
      const end = candidate.lastIndexOf("}");
      if (start !== -1 && end > start) {
        try {
          return JSON.parse(candidate.slice(start, end + 1)) as T;
        } catch {
          // fall through to the next candidate
        }
      }
    }
  }

  throw new Error(`Model response was not valid JSON. First 300 characters: ${text.slice(0, 300)}`);
}

function messagesFor(request: TextRequest) {
  const system = request.json
    ? `${request.system ?? ""}\nRespond with a single JSON object and nothing else.`.trim()
    : request.system;
  return [
    ...(system ? [{ role: "system" as const, content: system }] : []),
    { role: "user" as const, content: request.prompt },
  ];
}

async function callOpenAiCompatible(
  baseUrl: string,
  apiKey: string | undefined,
  request: TextRequest,
): Promise<{ text: string; model?: string }> {
  const model = process.env.LOCAL_AI_LLM_MODEL ?? "local";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({
      model,
      messages: messagesFor(request),
      temperature: request.temperature,
      max_tokens: request.maxTokens,
      ...(request.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Local LLM returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }

  const body = (await response.json()) as { model?: string; choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("Local LLM returned no completion text.");
  return { text, model: body.model ?? model };
}

async function callGemini(request: TextRequest): Promise<{ text: string; model?: string }> {
  const client = getGeminiClient(request.account);
  const model = process.env.GEMINI_TEXT_MODEL ?? "gemini-3.6-flash";
  try {
    const response = await client.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: request.prompt }] }],
      config: {
        ...(request.system ? { systemInstruction: request.system } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.json ? { responseMimeType: "application/json" } : {}),
      },
    });
    const text = response.text;
    if (!text) throw new Error("Gemini returned no text.");
    return { text, model };
  } catch (err) {
    wrapGeminiError("gemini", err);
  }
}
