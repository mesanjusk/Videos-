/**
 * Fixed-window in-memory rate limiter, ported from Project B (this project had none).
 *
 * Deliberately in-memory: it is a per-instance backstop against a runaway client or a stuck retry
 * loop, not a distributed quota. On Vercel each serverless instance keeps its own bucket, so the
 * effective limit is `limit × instances` — that is fine for the abuse cases it exists to blunt, and
 * anything needing a true global limit should use Redis (which `core/queue/connection.ts` already
 * holds a connection to). Documented here so nobody mistakes it for the latter.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

// Bounded so a stream of distinct keys (per-user, per-IP) can't grow the map without limit.
const MAX_BUCKETS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  if (buckets.size > MAX_BUCKETS) {
    for (const [k, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(k);
    // Still over after sweeping expired entries — the traffic is genuinely that wide. Drop the
    // whole map rather than growing unbounded; the worst case is one forgiven window.
    if (buckets.size > MAX_BUCKETS) buckets.clear();
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }
  if (existing.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }
  existing.count += 1;
  return { allowed: true, remaining: limit - existing.count, resetAt: existing.resetAt };
}

/** Test-only helper — resets the module-scoped state between cases. */
export function __resetRateLimitBuckets(): void {
  buckets.clear();
}
