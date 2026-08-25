import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, __resetRateLimitBuckets } from "./rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => __resetRateLimitBuckets());

  it("allows up to the limit then blocks", () => {
    for (let i = 0; i < 3; i++) expect(checkRateLimit("k", 3, 60_000).allowed).toBe(true);
    expect(checkRateLimit("k", 3, 60_000).allowed).toBe(false);
  });

  it("counts down remaining", () => {
    expect(checkRateLimit("k", 3, 60_000).remaining).toBe(2);
    expect(checkRateLimit("k", 3, 60_000).remaining).toBe(1);
  });

  it("tracks keys independently", () => {
    checkRateLimit("a", 1, 60_000);
    expect(checkRateLimit("a", 1, 60_000).allowed).toBe(false);
    expect(checkRateLimit("b", 1, 60_000).allowed).toBe(true);
  });

  it("opens a fresh window once the old one expires", async () => {
    expect(checkRateLimit("k", 1, 1).allowed).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(checkRateLimit("k", 1, 1).allowed).toBe(true);
  });
});
