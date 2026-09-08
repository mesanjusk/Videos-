import { describe, it, expect } from "vitest";
import { readQuotaDetail } from "./gemini-client";

/** The exact body this deployment received, trimmed to the part that matters. */
const ZERO_ALLOWANCE = `got status: 429 Too Many Requests. {"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details. \\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-2.5-flash-preview-image\\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 0, model: gemini-2.5-flash-preview-image\\nPlease retry in 9.59776082s.","status":"RESOURCE_EXHAUSTED"}}`;

/** And the one from the day before, which was a genuine daily allowance running out. */
const SPENT_ALLOWANCE = `got status: 429 Too Many Requests. {"error":{"code":429,"message":"You exceeded your current quota. \\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3.6-flash\\nPlease retry in 26.692917314s.","status":"RESOURCE_EXHAUSTED"}}`;

describe("readQuotaDetail", () => {
  it("recognises an allowance of zero as not a quota to wait out", () => {
    // The live failure. This key had generated nothing for days; the model is simply not on the
    // free tier, so waiting for a reset waits for something that never arrives.
    expect(readQuotaDetail(ZERO_ALLOWANCE)).toEqual({
      model: "gemini-2.5-flash-preview-image",
      allowanceIsZero: true,
    });
  });

  it("recognises a real allowance that ran out", () => {
    expect(readQuotaDetail(SPENT_ALLOWANCE)).toEqual({ model: "gemini-3.6-flash", allowanceIsZero: false });
  });

  it("does not call a mixed response zero, since part of it does come back", () => {
    const mixed = `limit: 0, model: some-model\nlimit: 15, model: some-model`;
    expect(readQuotaDetail(mixed)?.allowanceIsZero).toBe(false);
  });

  it("reports nothing when the message carries no limit at all", () => {
    expect(readQuotaDetail("got status: 429 Too Many Requests. Slow down.")).toBeUndefined();
  });
});
