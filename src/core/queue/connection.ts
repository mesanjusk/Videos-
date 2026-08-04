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
