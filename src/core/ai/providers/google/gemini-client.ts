import { GoogleGenAI } from "@google/genai";
import type { GenerationAccountContext } from "../../types";
import { ProviderQuotaExceededError } from "../../types";

/**
 * Resolves a Gemini SDK client for the given call.
 *
 * The Gemini Developer API (the free tier) authenticates with a per-Google-account API key
 * generated in AI Studio, not a raw OAuth access token — so the pooled Google Account Manager
 * (see modules/accounts) stores one encrypted `apiKey` per connected account, and the account
 * selector hands that key to the provider here. A `GEMINI_API_KEY` env var is only a fallback
 * for local development before any account has been connected.
 */
export function getGeminiClient(account?: GenerationAccountContext): GoogleGenAI {
  const apiKey = account?.apiKey ?? requireServerKey();
  return new GoogleGenAI({ apiKey });
}

function requireServerKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "No Gemini credential available: connect a Google account in Account Manager, or set GEMINI_API_KEY for local dev.",
    );
  }
  return key;
}

/**
 * Normalizes Gemini SDK quota/rate errors into the provider-agnostic error type. Logs the raw SDK
 * message before discarding it — ProviderQuotaExceededError's own message is a generic
 * "quota exceeded" with no detail, so without this log there's no way to tell a real free-tier
 * exhaustion apart from, say, a per-minute rate limit or something else entirely that merely
 * happens to match this regex (it's deliberately broad: "quota", "rate limit", "429",
 * "RESOURCE_EXHAUSTED").
 */
export function wrapGeminiError(providerId: string, err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (/quota|rate.?limit|429|RESOURCE_EXHAUSTED/i.test(message)) {
    console.error(`[gemini] ${providerId} call rejected, raw SDK message: ${message}`);
    throw new ProviderQuotaExceededError(providerId);
  }
  throw err instanceof Error ? err : new Error(message);
}
