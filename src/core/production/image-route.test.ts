import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HydratedDocument } from "mongoose";
import type { JobDoc } from "@/modules/jobs/models/Job";
import { ProviderQuotaExceededError } from "@/core/ai/types";

// vi.mock factories are hoisted above every const in this file, so anything they close over has to
// be created inside vi.hoisted rather than declared below them.
const mocks = vi.hoisted(() => {
  class FlowMissionPendingError extends Error {
    constructor(readonly runIds: string[]) {
      super("pending");
      this.name = "FlowMissionPendingError";
    }
  }
  return {
    marked: new Map<string, string>(),
    flowSession: { value: null as { accountId: string } | null },
    geminiCredential: { value: "none" as "usable" | "unusable" | "none" },
    geminiProvider: { id: "gemini" },
    ideogramProvider: { id: "ideogram" },
    resolveFlowImages: vi.fn(),
    FlowMissionPendingError,
  };
});

vi.mock("@/core/ai/provider-health", () => ({
  markModelUnavailable: vi.fn(async (providerId: string, model: string | undefined, reason: string) => {
    mocks.marked.set(`${providerId}:${model ?? "*"}`, reason);
  }),
  isModelUnavailable: vi.fn(async (providerId: string, model?: string) => mocks.marked.has(`${providerId}:${model ?? "*"}`)),
}));

vi.mock("@/core/ai/registry", () => ({
  BROWSER_IMAGE_PROVIDER_ID: "flow-browser",
  getImageProvider: (id: string) => {
    if (id === "gemini") return mocks.geminiProvider;
    if (id === "ideogram") return mocks.ideogramProvider;
    throw new Error(`Unknown image provider "${id}"`);
  },
}));

vi.mock("@/modules/accounts/service", () => ({
  findAccountWithFlowSession: vi.fn(async () => mocks.flowSession.value),
  describePooledGeminiCredential: vi.fn(async () => mocks.geminiCredential.value),
}));

vi.mock("./flow-image-step", () => ({
  resolveFlowImages: mocks.resolveFlowImages,
  FlowMissionPendingError: mocks.FlowMissionPendingError,
}));

import { routeImages, imageRouteCandidates } from "./image-route";

const job = { _id: "job1", userId: "u1", payload: {} } as unknown as HydratedDocument<JobDoc>;
const anImage = { data: Buffer.from("x"), mimeType: "image/png", width: 1, height: 1 };

/** A refusal that will never become a success: the model has no allowance at all on this key. */
const zeroAllowance = () =>
  new ProviderQuotaExceededError("gemini", undefined, { model: "gemini-2.5-flash-preview-image", allowanceIsZero: true });
/** A refusal that might well succeed next time. */
const spentAllowance = () => new ProviderQuotaExceededError("gemini", 30, { model: "gemini-3.6-flash", allowanceIsZero: false });

beforeEach(() => {
  mocks.marked.clear();
  mocks.flowSession.value = null;
  mocks.geminiCredential.value = "none";
  vi.clearAllMocks();
  process.env.GEMINI_API_KEY = "test-key";
  process.env.IDEOGRAM_API_KEY = "test-key";
  process.env.ENABLE_IDEOGRAM = "true";
  process.env.GEMINI_IMAGE_MODEL = "gemini-2.5-flash-preview-image";
});
afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.IDEOGRAM_API_KEY;
  delete process.env.ENABLE_IDEOGRAM;
  delete process.env.GEMINI_IMAGE_MODEL;
});

function request(viaApi: (p: unknown) => Promise<Record<string, typeof anImage>>) {
  return {
    preferredProviderId: "gemini",
    prompts: [{ key: "image", prompt: "a red bicycle" }],
    viaApi: viaApi as never,
    flow: {},
  };
}

describe("routeImages", () => {
  it("uses the configured provider when it works", async () => {
    const viaApi = vi.fn(async () => ({ image: anImage }));
    const result = await routeImages(job, request(viaApi));

    expect(result.image).toBe(anImage);
    expect(viaApi).toHaveBeenCalledTimes(1);
  });

  it("moves to the next provider when the first cannot ever serve", async () => {
    // The live failure: `limit: 0` is not a quota to wait out, so waiting is the wrong response and
    // so is failing the job. There is another provider configured; use it.
    const viaApi = vi
      .fn()
      .mockRejectedValueOnce(zeroAllowance())
      .mockResolvedValueOnce({ image: anImage });

    const result = await routeImages(job, request(viaApi));

    expect(result.image).toBe(anImage);
    expect(viaApi).toHaveBeenCalledTimes(2);
  });

  it("remembers the refusal, so the next job does not spend a call rediscovering it", async () => {
    await routeImages(job, request(vi.fn().mockRejectedValueOnce(zeroAllowance()).mockResolvedValueOnce({ image: anImage })));

    expect([...mocks.marked.keys()]).toContain("gemini:gemini-2.5-flash-preview-image");
    expect(await imageRouteCandidates("u1", "gemini")).not.toContain("gemini");
  });

  it("does NOT move on for a quota that will come back", async () => {
    // Falling through on a transient failure would spread one project's work across every provider
    // a deployment has — which is how a free-tier account quietly becomes a paid one.
    const viaApi = vi.fn().mockRejectedValue(spentAllowance());

    await expect(routeImages(job, request(viaApi))).rejects.toBeInstanceOf(ProviderQuotaExceededError);
    expect(viaApi).toHaveBeenCalledTimes(1);
  });

  it("does NOT move on for an ordinary failure", async () => {
    const viaApi = vi.fn().mockRejectedValue(new Error("503 Service Unavailable"));

    await expect(routeImages(job, request(viaApi))).rejects.toThrow(/503/);
    expect(viaApi).toHaveBeenCalledTimes(1);
  });

  it("lets a parked browser mission through untouched", async () => {
    // Parking is not a failure, and treating it as one would start missions on every other provider
    // while the browser is already drawing the image.
    mocks.flowSession.value = { accountId: "acc1" };
    mocks.resolveFlowImages.mockRejectedValueOnce(new mocks.FlowMissionPendingError(["run1"]));
    const viaApi = vi.fn();

    await expect(
      routeImages(job, { ...request(viaApi), preferredProviderId: "flow-browser" }),
    ).rejects.toBeInstanceOf(mocks.FlowMissionPendingError);
    expect(viaApi).not.toHaveBeenCalled();
  });

  it("says what to configure when nothing can serve", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.IDEOGRAM_API_KEY;
    delete process.env.ENABLE_IDEOGRAM;

    await expect(routeImages(job, { ...request(vi.fn()), preferredProviderId: null })).rejects.toThrow(
      /No image provider is configured/,
    );
  });

  it("tells a user with disabled accounts to reactivate one, not to connect one", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.IDEOGRAM_API_KEY;
    delete process.env.ENABLE_IDEOGRAM;
    mocks.geminiCredential.value = "unusable";

    await expect(routeImages(job, { ...request(vi.fn()), preferredProviderId: null })).rejects.toThrow(
      /switched off or over the quota/,
    );
  });

  it("explains a dead end as a configuration problem, not an exhausted quota", async () => {
    const viaApi = vi.fn().mockRejectedValue(zeroAllowance());

    await expect(routeImages(job, request(viaApi))).rejects.toThrow(/not exhausted quotas/);
  });
});

describe("imageRouteCandidates", () => {
  it("prefers the browser route when nothing is chosen and Flow is connected", async () => {
    // The product's visual pipeline is Flow. An image API was the default only because the code was
    // assembled API-first, and that is how a browser-driven studio died over an image model's tier.
    mocks.flowSession.value = { accountId: "acc1" };
    expect((await imageRouteCandidates("u1"))[0]).toBe("flow-browser");
  });

  it("falls back to the API order when no Flow session exists", async () => {
    expect((await imageRouteCandidates("u1"))[0]).toBe("gemini");
  });

  it("puts the requested provider first", async () => {
    expect((await imageRouteCandidates("u1", "ideogram"))[0]).toBe("ideogram");
  });

  it("drops providers that are not configured", async () => {
    delete process.env.IDEOGRAM_API_KEY;
    expect(await imageRouteCandidates("u1")).not.toContain("ideogram");
  });

  it("counts a connected Google account as Gemini's credential, not just the env key", async () => {
    // Reported live as "No image provider is configured … connect a Google account" on a deployment
    // that had connected one: GEMINI_API_KEY is the local-dev fallback, and the real credential is
    // the encrypted key on a pooled account. The text gateway always knew that; this route did not.
    delete process.env.GEMINI_API_KEY;
    expect(await imageRouteCandidates("u1")).not.toContain("gemini");

    mocks.geminiCredential.value = "usable";
    expect(await imageRouteCandidates("u1")).toContain("gemini");
  });

  it("does not count an account pool that cannot currently serve", async () => {
    // Disabled or over quota means selectGoogleAccount would throw, so offering Gemini here would
    // only move the failure one step later.
    delete process.env.GEMINI_API_KEY;
    mocks.geminiCredential.value = "unusable";
    expect(await imageRouteCandidates("u1")).not.toContain("gemini");
  });

  it("does not offer the browser route without a connected Flow session", async () => {
    // It declares no env requirements, so nothing else would exclude it — and a mission enqueued
    // with no session to run it parks the job forever. Exactly the trap the un-deployed worker set.
    expect(await imageRouteCandidates("u1")).not.toContain("flow-browser");

    mocks.flowSession.value = { accountId: "acc1" };
    expect(await imageRouteCandidates("u1")).toContain("flow-browser");
  });
});
