import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  checkProviderAllowed,
  rankProviders,
  selectProvider,
  resolveCostPolicy,
  assertProviderAllowed,
  CostPolicyViolationError,
  NoPermittedProviderError,
  freeCostPolicy,
  paidCostPolicy,
  unknownCostPolicy,
  meteredFreeTierCostPolicy,
  type CostPolicyCandidate,
} from "./index";
import { PROVIDER_METADATA, isProviderConfigured } from "@/core/ai/provider-metadata";

/**
 * ZERO_COST_MODE_MUST_NOT_SPEND
 *
 * The cost-safety suite. It fails if any of these become true:
 *   - a paid provider is selectable under ZERO_COST
 *   - an unknown-cost provider is selectable under ZERO_COST
 *   - a metered free tier is treated as free
 *   - "no free route available" silently resolves to a paid one instead of refusing
 *   - a provider in the shipped metadata is classified free without a stated basis
 *
 * The last one is the one that will catch a future mistake: it walks the real provider table
 * rather than fixtures, so adding a provider and forgetting to classify it fails here.
 */

const free = (id: string): CostPolicyCandidate => ({
  id,
  available: true,
  cost: freeCostPolicy({ rationale: "local" }),
});
const paid = (id: string): CostPolicyCandidate => ({
  id,
  available: true,
  cost: paidCostPolicy({ rationale: "metered", usdPerUnit: 0.02 }),
});
const unknown = (id: string): CostPolicyCandidate => ({ id, available: true, cost: unknownCostPolicy() });
const freeTier = (id: string): CostPolicyCandidate => ({
  id,
  available: true,
  cost: meteredFreeTierCostPolicy({ rationale: "free allowance then metered" }),
});

beforeEach(() => {
  delete process.env.ENABLE_ZERO_COST_MODE;
  delete process.env.DEFAULT_COST_POLICY;
});
afterEach(() => {
  delete process.env.ENABLE_ZERO_COST_MODE;
  delete process.env.DEFAULT_COST_POLICY;
});

describe("ZERO_COST refuses to spend", () => {
  it("permits a verifiably free provider", () => {
    expect(checkProviderAllowed("ZERO_COST", free("local-image")).allowed).toBe(true);
  });

  it("refuses a paid provider", () => {
    const decision = checkProviderAllowed("ZERO_COST", paid("ideogram"));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/metered/);
  });

  it("refuses an unknown-cost provider — unverified counts as paid", () => {
    const decision = checkProviderAllowed("ZERO_COST", unknown("some-new-api"));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/unverified/);
  });

  it("refuses a metered free tier, because the call after the allowance bills silently", () => {
    expect(checkProviderAllowed("ZERO_COST", freeTier("gemini")).allowed).toBe(false);
  });

  it("filters every paid and unknown provider out of the ranking", () => {
    const ranked = rankProviders("ZERO_COST", [paid("a"), unknown("b"), free("c"), freeTier("d")]);
    expect(ranked.map((r) => r.id)).toEqual(["c"]);
  });

  it("refuses rather than falling back when no free route exists", () => {
    // This is the whole point. A fallback that costs money is the behaviour the policy was
    // selected to prevent, so "none available" must be an error, not a downgrade.
    expect(() => selectProvider("ZERO_COST", "image", [paid("a"), unknown("b")])).toThrow(NoPermittedProviderError);
  });

  it("names what it considered and why, so the failure is actionable", () => {
    try {
      selectProvider("ZERO_COST", "video", [paid("runway"), unknown("kling")]);
      expect.unreachable("should have refused");
    } catch (err) {
      expect(err).toBeInstanceOf(NoPermittedProviderError);
      expect((err as Error).message).toContain("runway");
      expect((err as Error).message).toContain("kling");
    }
  });

  it("throws a typed violation when a paid provider is asserted directly", () => {
    expect(() => assertProviderAllowed("ZERO_COST", paid("ideogram"))).toThrow(CostPolicyViolationError);
  });

  it("refuses a free provider that is not actually configured", () => {
    expect(checkProviderAllowed("ZERO_COST", { ...free("voicebox"), available: false }).allowed).toBe(false);
  });
});

describe("the other policies", () => {
  it("FREE_PREFERRED puts free first but forbids nothing", () => {
    const ranked = rankProviders("FREE_PREFERRED", [paid("a"), free("b"), unknown("c")]);
    expect(ranked[0]!.id).toBe("b");
    expect(ranked).toHaveLength(3);
  });

  it("BEST_QUALITY puts the paid provider first", () => {
    expect(rankProviders("BEST_QUALITY", [free("a"), paid("b")])[0]!.id).toBe("b");
  });

  it("BALANCED preserves the configured order", () => {
    expect(rankProviders("BALANCED", [paid("a"), free("b")]).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("policy resolution", () => {
  it("defaults to BALANCED, so an untouched deployment behaves as it always did", () => {
    expect(resolveCostPolicy()).toBe("BALANCED");
  });

  it("honours a per-run request", () => {
    expect(resolveCostPolicy("ZERO_COST")).toBe("ZERO_COST");
  });

  it("ignores an unrecognised value rather than trusting it", () => {
    expect(resolveCostPolicy("CHEAP_PLEASE")).toBe("BALANCED");
  });

  it("refuses ZERO_COST outright when the operator disabled it, instead of quietly downgrading", () => {
    process.env.ENABLE_ZERO_COST_MODE = "false";
    // Silently returning BALANCED here would mean a caller who asked not to spend money then spends it.
    expect(() => resolveCostPolicy("ZERO_COST")).toThrow(/ENABLE_ZERO_COST_MODE/);
  });
});

describe("the shipped provider table", () => {
  it("classifies every provider, with a stated basis", () => {
    for (const provider of PROVIDER_METADATA) {
      expect(provider.cost.rationale, `${provider.capability}/${provider.id} has no rationale`).toBeTruthy();
      expect(["free", "paid", "unknown"]).toContain(provider.cost.costClass);
    }
  });

  it("only classifies as free what genuinely runs without metering", () => {
    // If a cloud API ever appears in this list, someone has classified a metered service as free.
    const freeOnes = PROVIDER_METADATA.filter((p) => p.cost.isFree());
    for (const provider of freeOnes) {
      expect(provider.execution, `${provider.id} is marked free but runs as ${provider.execution}`).not.toBe("cloud-api");
    }
  });

  it("never lets a cloud API through ZERO_COST", () => {
    for (const provider of PROVIDER_METADATA.filter((p) => p.execution === "cloud-api")) {
      expect(
        checkProviderAllowed("ZERO_COST", { id: provider.id, cost: provider.cost, available: true }).allowed,
        `${provider.id} (${provider.capability}) is selectable under ZERO_COST`,
      ).toBe(false);
    }
  });

  it("does not treat a gateway as free — its cost is whichever upstream it picks", () => {
    const omniroute = PROVIDER_METADATA.find((p) => p.id === "omniroute");
    expect(omniroute?.cost.canRunInZeroCostMode()).toBe(false);
  });

  it("keeps FFmpeg free and available with no configuration, so a ZERO_COST render always has a renderer", () => {
    const ffmpeg = PROVIDER_METADATA.find((p) => p.id === "ffmpeg" && p.capability === "render")!;
    expect(ffmpeg.cost.canRunInZeroCostMode()).toBe(true);
    expect(isProviderConfigured(ffmpeg)).toBe(true);
  });
});
