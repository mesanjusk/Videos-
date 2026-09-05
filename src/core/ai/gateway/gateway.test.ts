import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AiGateway } from "./gateway";
import { NoPermittedProviderError } from "@/core/cost";
import { ProviderQuotaExceededError } from "@/core/ai/types";
import { freeCostPolicy, paidCostPolicy, unknownCostPolicy } from "@/core/cost";
import type { ProviderRuntimeDescriptor } from "@/core/ai/provider-metadata";

const localFree: ProviderRuntimeDescriptor = {
  id: "local-image",
  label: "Local",
  capability: "image",
  execution: "local-service",
  cost: freeCostPolicy({ rationale: "self-hosted" }),
  requirements: [],
  fallbacks: [],
};
const cloudPaid: ProviderRuntimeDescriptor = {
  id: "ideogram",
  label: "Ideogram",
  capability: "image",
  execution: "cloud-api",
  cost: paidCostPolicy({ rationale: "metered", usdPerUnit: 0.02 }),
  requirements: [],
};
const cloudUnknown: ProviderRuntimeDescriptor = {
  id: "mystery",
  label: "Mystery",
  capability: "image",
  execution: "cloud-api",
  cost: unknownCostPolicy(),
  requirements: [],
};

const catalogue = [cloudPaid, cloudUnknown, localFree];

beforeEach(() => {
  delete process.env.DEFAULT_COST_POLICY;
  delete process.env.ENABLE_ZERO_COST_MODE;
});
afterEach(() => vi.restoreAllMocks());

describe("AiGateway.resolve", () => {
  it("prefers a local execution path over a cloud API", () => {
    // Not a cost decision — the policy already had its say. A local service is the one that still
    // works with no network, key or quota.
    expect(new AiGateway(catalogue).resolve("image").descriptor.id).toBe("local-image");
  });

  it("honours an explicit provider preference when the policy permits it", () => {
    expect(new AiGateway(catalogue).resolve("image", { preferredProviderId: "ideogram" }).descriptor.id).toBe("ideogram");
  });

  it("ignores a preference the cost policy forbids", () => {
    const resolution = new AiGateway(catalogue).resolve("image", {
      costPolicy: "ZERO_COST",
      preferredProviderId: "ideogram",
    });
    expect(resolution.descriptor.id).toBe("local-image");
  });

  it("refuses when nothing is permitted, naming what it considered", () => {
    const gateway = new AiGateway([cloudPaid, cloudUnknown]);
    expect(() => gateway.resolve("image", { costPolicy: "ZERO_COST" })).toThrow(NoPermittedProviderError);
  });

  it("treats an unconfigured provider as unavailable", () => {
    const needsKey: ProviderRuntimeDescriptor = { ...cloudPaid, id: "needs-key", requirements: ["A_KEY_NOBODY_SET"] };
    expect(new AiGateway([needsKey, localFree]).resolve("image").descriptor.id).toBe("local-image");
  });

  it("accepts a requirement the caller supplies at runtime", () => {
    // A pooled Google account's key is a real Gemini credential that is deliberately not in the
    // environment. Without this, a deployment that keeps its keys on connected accounts has no
    // text provider at all — which is exactly how a Director run failed with "no provider".
    const needsKey: ProviderRuntimeDescriptor = { ...cloudPaid, id: "needs-key", requirements: ["A_KEY_NOBODY_SET"] };
    const gateway = new AiGateway([needsKey]);

    expect(() => gateway.resolve("image")).toThrow(NoPermittedProviderError);
    expect(gateway.resolve("image", { suppliedRequirements: ["A_KEY_NOBODY_SET"] }).descriptor.id).toBe("needs-key");
  });

  it("says what to configure rather than only that nothing is configured", () => {
    const needsKey: ProviderRuntimeDescriptor = { ...cloudPaid, id: "needs-key", requirements: ["A_KEY_NOBODY_SET"] };
    const hinted: ProviderRuntimeDescriptor = {
      ...cloudPaid,
      id: "hinted",
      requirements: ["ANOTHER_KEY_NOBODY_SET"],
      configurationHint: "connect an account, or set ANOTHER_KEY_NOBODY_SET",
    };

    expect(() => new AiGateway([needsKey, hinted]).resolve("image")).toThrow(
      /needs-key \(set A_KEY_NOBODY_SET\).*hinted \(connect an account, or set ANOTHER_KEY_NOBODY_SET\)/,
    );
  });
});

describe("AiGateway.execute", () => {
  it("falls back to the next permitted provider when one fails", async () => {
    const gateway = new AiGateway(catalogue);
    const outcome = await gateway.execute("image", { costPolicy: "BALANCED" }, async (descriptor) => {
      if (descriptor.id === "local-image") throw new Error("worker offline");
      return `served by ${descriptor.id}`;
    });

    expect(outcome.result).toBe("served by ideogram");
    expect(outcome.attempted).toEqual([{ providerId: "local-image", error: "worker offline" }]);
  });

  it("never escalates from free to paid when the policy is ZERO_COST", async () => {
    // The important negative. A failing free provider must not reach for the paid one, because
    // that turns a policy chosen to avoid spending into the thing that spends.
    const gateway = new AiGateway(catalogue);
    const touched: string[] = [];

    await expect(
      gateway.execute("image", { costPolicy: "ZERO_COST" }, async (descriptor) => {
        touched.push(descriptor.id);
        throw new Error("worker offline");
      }),
    ).rejects.toThrow(/Every provider for "image" failed/);

    expect(touched).toEqual(["local-image"]);
  });

  it("makes no outbound request at all when ZERO_COST has no free route", async () => {
    // The behavioural half of ZERO_COST_MODE_MUST_NOT_SPEND: not merely "does not select a paid
    // provider", but "does not call one".
    const fetchSpy = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchSpy);

    const gateway = new AiGateway([cloudPaid, cloudUnknown]);
    await expect(
      gateway.execute("image", { costPolicy: "ZERO_COST" }, async () => {
        await fetch("https://api.example.com/generate");
        return "should never happen";
      }),
    ).rejects.toThrow(NoPermittedProviderError);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("preserves a quota failure instead of flattening it into the aggregate error", async () => {
    // The queue's account rotation keys off this error *type* (processors/helpers.ts marks the
    // pooled account exhausted and lets BullMQ retry against another). Wrapping it in a plain
    // Error would silently switch that off for everything routed through the gateway.
    const gateway = new AiGateway([localFree]);

    await expect(
      gateway.execute("image", {}, async () => {
        throw new ProviderQuotaExceededError("local-image");
      }),
    ).rejects.toBeInstanceOf(ProviderQuotaExceededError);
  });

  it("reports which provider actually served the work", async () => {
    const outcome = await new AiGateway(catalogue).execute("image", {}, async (d) => d.id);
    expect(outcome.providerId).toBe("local-image");
    expect(outcome.policy).toBe("BALANCED");
  });
});
