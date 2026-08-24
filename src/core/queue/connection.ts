import IORedis from "ioredis";

declare global {
  var _redisConnection: IORedis | undefined;
}

/**
 * Shared ioredis connection for every BullMQ Queue/Worker (Upstash Redis, TLS).
 * `maxRetriesPerRequest: null` is required by BullMQ for the blocking connections it opens.
 */
export function getRedisConnection(): IORedis {
  if (!global._redisConnection) {
    const url = process.env.REDIS_URL;
    if (!url) {
      throw new Error("REDIS_URL is not set — configure your Upstash Redis connection string.");
    }
    global._redisConnection = new IORedis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return global._redisConnection;
}

/**
 * Closes the shared connection. Ported from Browser Automation OS — the studio never had one,
 * which meant `worker.ts` could not shut down cleanly (the process hung on an open Redis socket
 * until it was killed) and tests could not release it. Only the worker's shutdown path and tests
 * should call this; the serverless runtime deliberately keeps its connection across invocations.
 */
export async function closeRedisConnection(): Promise<void> {
  if (!global._redisConnection) return;
  await global._redisConnection.quit();
  global._redisConnection = undefined;
}
