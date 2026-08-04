import { connectToDatabase } from "@/core/db/mongoose";
import { GoogleAccount, type GoogleAccountDoc } from "./models/GoogleAccount";
import { decryptSecret } from "@/core/auth/encryption";
import type { HydratedDocument } from "mongoose";

export class NoAvailableGoogleAccountError extends Error {
  constructor(userId: string) {
    super(
      "No active Google account has remaining quota. Wait for quota to reset, or connect another Google account.",
    );
    this.name = "NoAvailableGoogleAccountError";
    this.userId = userId;
  }
  userId: string;
}

/**
 * Picks the next usable pooled Google account for a generation call (ARCHITECTURE.md §3):
 * active status, quota remaining, least-recently-used first, `isDefault` only as a tiebreak.
 * Never called with a specific account fixed — every AI provider call goes through this so
 * quota is automatically spread across the pool and exhausted accounts are skipped.
 */
export async function selectGoogleAccount(userId: string): Promise<HydratedDocument<GoogleAccountDoc>> {
  await connectToDatabase();

  const candidate = await GoogleAccount.findOne({
    userId,
    status: "active",
    $or: [{ "quota.dailyLimit": 0 }, { $expr: { $lt: ["$quota.used", "$quota.dailyLimit"] } }],
  })
    .sort({ isDefault: -1, lastUsedAt: 1 })
    .exec();

  if (!candidate) {
    throw new NoAvailableGoogleAccountError(userId);
  }

  candidate.lastUsedAt = new Date();
  await candidate.save();
  return candidate;
}

export function decryptAccountApiKey(account: HydratedDocument<GoogleAccountDoc>): string {
  const apiKeyEnc = account.credentials?.apiKeyEnc;
  if (!apiKeyEnc) {
    throw new Error(`Google account ${account._id.toString()} has no stored credential.`);
  }
  return decryptSecret(apiKeyEnc);
}

/**
 * Called by a queue processor when a provider call reports quota exhaustion (ProviderQuotaExceededError).
 * Default cool-down is intentionally short (60s), not a full day: `wrapGeminiError` classifies any
 * error whose message contains "quota", "rate limit", "429", or "RESOURCE_EXHAUSTED" as this same
 * error type, and most of those in practice are a transient per-minute rate limit (especially since
 * BullMQ retries a failed job 3x within ~15s, which alone can trip one) rather than the free tier's
 * actual daily image/request cap. Confirmed live: a flat 24h lockout meant one rate-limit blip took
 * an account out of rotation for a full day until someone noticed and clicked "Reactivate now" — and
 * clicking that while the real rate limit was still active just re-tripped it immediately. Callers
 * that *do* know the provider's real Retry-After value should still pass `resetsAt` explicitly.
 */
export async function markAccountQuotaExceeded(accountId: string, resetsAt?: Date): Promise<void> {
  await connectToDatabase();
  await GoogleAccount.updateOne(
    { _id: accountId },
    {
      $set: {
        status: "quota_exceeded",
        "quota.resetsAt": resetsAt ?? new Date(Date.now() + 60 * 1000),
      },
    },
  );
}

/** Called by the cron tick (or a scheduled reset) once `quota.resetsAt` has passed. */
export async function reactivateExpiredQuotas(): Promise<number> {
  await connectToDatabase();
  const result = await GoogleAccount.updateMany(
    { status: "quota_exceeded", "quota.resetsAt": { $lte: new Date() } },
    { $set: { status: "active", "quota.used": 0 }, $unset: { "quota.resetsAt": "" } },
  );
  return result.modifiedCount;
}

export async function recordAccountUsage(accountId: string): Promise<void> {
  await connectToDatabase();
  await GoogleAccount.updateOne({ _id: accountId }, { $inc: { "quota.used": 1 } });
}
