import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const redis = { get: vi.fn(), set: vi.fn(), del: vi.fn() };
vi.mock("./connection", () => ({ getRedisConnection: () => redis }));

import {
  getWorkerPresence,
  isWorkerRunning,
  startWorkerHeartbeat,
  stopWorkerHeartbeat,
  HEARTBEAT_TTL_SECONDS,
} from "./worker-presence";

beforeEach(() => {
  redis.get.mockReset();
  redis.set.mockReset().mockResolvedValue("OK");
  redis.del.mockReset().mockResolvedValue(1);
});
afterEach(() => vi.restoreAllMocks());

describe("worker presence", () => {
  it("reports no worker when nothing has announced itself", async () => {
    redis.get.mockResolvedValue(null);
    expect(await isWorkerRunning()).toBe(false);
  });

  it("reports the worker that announced itself", async () => {
    redis.get.mockResolvedValue(JSON.stringify({ workerId: "worker-1", queues: ["render"], lastSeenAt: "2026-09-07T12:00:00.000Z" }));
    expect(await getWorkerPresence()).toEqual({
      alive: true,
      workerId: "worker-1",
      queues: ["render"],
      lastSeenAt: "2026-09-07T12:00:00.000Z",
    });
  });

  it("answers 'no worker' when Redis cannot be reached, rather than throwing", async () => {
    // The safe direction: callers use this to decide whether to hand off work that only a worker
    // can do. Guessing "yes" on an error would send that work into a queue nothing drains.
    redis.get.mockRejectedValue(new Error("connection refused"));
    expect(await isWorkerRunning()).toBe(false);
  });

  it("answers 'no worker' on a corrupt heartbeat", async () => {
    redis.get.mockResolvedValue("not json");
    expect(await isWorkerRunning()).toBe(false);
  });

  it("announces immediately on start, with a TTL so death needs no cleanup", () => {
    const timer = startWorkerHeartbeat("worker-1", ["render", "browser_task"]);
    clearInterval(timer);

    expect(redis.set).toHaveBeenCalledTimes(1);
    const [key, payload, mode, ttl] = redis.set.mock.calls[0] ?? [];
    expect(key).toBe("worker:heartbeat");
    expect(mode).toBe("EX");
    expect(ttl).toBe(HEARTBEAT_TTL_SECONDS);
    expect(JSON.parse(payload)).toMatchObject({ workerId: "worker-1", queues: ["render", "browser_task"] });
  });

  it("does not crash the worker when its own heartbeat fails", () => {
    redis.set.mockRejectedValue(new Error("redis down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => clearInterval(startWorkerHeartbeat("worker-1", []))).not.toThrow();
  });

  it("clears the heartbeat on a clean shutdown so 'gone' is known at once", async () => {
    await stopWorkerHeartbeat();
    expect(redis.del).toHaveBeenCalledWith("worker:heartbeat");
  });
});
