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
    throw new ProviderQuotaExceededError(providerId, undefined, readQuotaDetail(message));
  }
  throw err instanceof Error ? err : new Error(message);
}

/**
 * Reads what the 429 actually says about the limit.
 *
 * Google reports "you have used up your allowance" and "you have no allowance" through the same
 * status, distinguished only by the number: `limit: 20` against `limit: 0`. They mean opposite
 * things. An exhausted allowance returns tomorrow; a zero one never does, because the model is not
 * on the free tier at all and no amount of waiting adds it.
 *
 * Confirmed live, and it is why this exists: every image in this studio failed with
 * `limit: 0, model: gemini-2.5-flash-preview-image` on a key that had generated nothing for days.
 * The app read that as an exhausted quota, benched the account for it, and then reported every
 * later step as having no account left — a configuration problem wearing the costume of a
 * rate limit, and taking a perfectly good text credential down with it.
 */
export function readQuotaDetail(message: string): { model?: string; allowanceIsZero?: boolean } | undefined {
  const limits = [...message.matchAll(/limit:\s*(\d+),\s*model:\s*([\w.\-]+)/gi)].map((m) => ({
    limit: Number(m[1]),
    model: m[2],
  }));
  if (limits.length === 0) return undefined;

  // Only when *every* reported limit is zero. A response mixing a spent per-minute limit with a
  // zero daily one is still, in part, something that waiting fixes.
  const allowanceIsZero = limits.every((l) => l.limit === 0);
  return { model: limits[0]?.model, allowanceIsZero };
}
