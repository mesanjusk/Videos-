import { describe, it, expect, vi, beforeEach } from "vitest";

const redis = { get: vi.fn(), set: vi.fn(), del: vi.fn() };
vi.mock("@/core/queue/connection", () => ({ getRedisConnection: () => redis }));

import {
  getExtensionPresence,
  isExtensionConnected,
  recordExtensionHeartbeat,
  clearExtensionHeartbeat,
  EXTENSION_HEARTBEAT_TTL_SECONDS,
  EXTENSION_HEARTBEAT_INTERVAL_MS,
} from "./extension-presence";

beforeEach(() => {
  redis.get.mockReset();
  redis.set.mockReset().mockResolvedValue("OK");
  redis.del.mockReset().mockResolvedValue(1);
});

describe("extension presence", () => {
  it("reports nothing connected when no extension has checked in", async () => {
    redis.get.mockResolvedValue(null);
    expect(await isExtensionConnected()).toBe(false);
  });

  it("reports the extension that checked in", async () => {
    redis.get.mockResolvedValue(
      JSON.stringify({ workerId: "chrome-abc", lastSeenAt: "2026-09-13T12:00:00.000Z", detail: { version: "1.1.0" } }),
    );
    expect(await getExtensionPresence()).toEqual({
      connected: true,
      workerId: "chrome-abc",
      lastSeenAt: "2026-09-13T12:00:00.000Z",
      detail: { version: "1.1.0" },
    });
  });

  it("expires on its own, so a closed browser needs no cleanup", async () => {
    await recordExtensionHeartbeat("chrome-abc");
    const [key, , mode, ttl] = redis.set.mock.calls[0] ?? [];
    expect(key).toBe("extension:heartbeat");
    expect(mode).toBe("EX");
    expect(ttl).toBe(EXTENSION_HEARTBEAT_TTL_SECONDS);
  });

  it("checks in comfortably more often than it expires", () => {
    // One missed ping — a sleeping laptop, a slow request — must not read as a disconnection.
    expect(EXTENSION_HEARTBEAT_INTERVAL_MS * 2).toBeLessThan(EXTENSION_HEARTBEAT_TTL_SECONDS * 1000);
  });

  it("answers 'not connected' when Redis cannot be reached, rather than throwing", async () => {
    // The safe direction, and the same one worker presence takes: callers use this to decide
    // whether to enqueue a mission. Guessing "yes" sends work to a browser that is not there.
    redis.get.mockRejectedValue(new Error("connection refused"));
    expect(await isExtensionConnected()).toBe(false);
  });

  it("answers 'not connected' on a corrupt check-in", async () => {
    redis.get.mockResolvedValue("not json");
    expect(await isExtensionConnected()).toBe(false);
  });

  it("never throws at the extension over a failed check-in", async () => {
    redis.set.mockRejectedValue(new Error("redis down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordExtensionHeartbeat("chrome-abc")).resolves.toBeUndefined();
  });

  it("clears the check-in, so switching claiming off is known at once", async () => {
    await clearExtensionHeartbeat();
    expect(redis.del).toHaveBeenCalledWith("extension:heartbeat");
  });
});
