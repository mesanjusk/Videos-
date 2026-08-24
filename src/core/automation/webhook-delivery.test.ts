import { describe, expect, it, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { deliverWebhook } from "./webhook-delivery";

/**
 * Adapted from Browser Automation OS's test. One assertion changed on purpose: that implementation
 * signed the body alone, so a captured delivery could be replayed against the receiver forever.
 * This one signs `timestamp.body` and sends the timestamp in its own header, which is what lets a
 * receiver reject a replay. The test asserts the new construction.
 */
describe("deliverWebhook", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs the JSON payload and succeeds on a 2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await deliverWebhook("https://crm.example.com/hook", { event: "automation.completed" });

    expect(result).toEqual({ ok: true, status: 200 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://crm.example.com/hook");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ event: "automation.completed" });
  });

  it("signs timestamp.body with HMAC-SHA256 when a secret is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await deliverWebhook("https://crm.example.com/hook", { event: "automation.failed" }, "shhh");

    const [, init] = fetchMock.mock.calls[0]!;
    const timestamp = init.headers["X-Webhook-Timestamp"];
    expect(timestamp).toMatch(/^\d+$/);
    const expected = crypto.createHmac("sha256", "shhh").update(`${timestamp}.${init.body}`).digest("hex");
    expect(init.headers["X-Webhook-Signature"]).toBe(`sha256=${expected}`);
  });

  it("sends no signature header when no secret is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await deliverWebhook("https://crm.example.com/hook", {});

    expect(fetchMock.mock.calls[0]![1].headers["X-Webhook-Signature"]).toBeUndefined();
  });

  it("throws on a non-2xx response, so BullMQ's retry engages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    await expect(deliverWebhook("https://crm.example.com/hook", {})).rejects.toThrow(/503/);
  });

  it("propagates a network failure rather than swallowing it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    await expect(deliverWebhook("https://crm.example.com/hook", {})).rejects.toThrow("ECONNREFUSED");
  });

  it("aborts a receiver that never responds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))),
      ),
    );

    await expect(deliverWebhook("https://crm.example.com/hook", {}, undefined, { timeoutMs: 10 })).rejects.toThrow();
  });
});
