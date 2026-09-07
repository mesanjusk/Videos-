import { connectToDatabase } from "@/core/db/mongoose";
import { GoogleAccount, type GoogleAccountDoc } from "./models/GoogleAccount";
import { decryptSecret } from "@/core/auth/encryption";
import type { HydratedDocument } from "mongoose";

/**
 * Raised when the pool has nothing usable — for one of three quite different reasons.
 *
 * This used to say "No active Google account has remaining quota. Wait for quota to reset" for all
 * of them, including the case where no account had ever been connected. That message sent people to
 * wait out a quota that was never consumed, on an account that did not exist. Reported live, and
 * fairly: "it's not possible quota exhaust, we haven't used it for 3-4 days."
 *
 * Nothing here is Google's answer. It is this application's own bookkeeping — a Mongo query over
 * the accounts a user has connected. Google's own limits arrive separately, as a 429 on a real call
 * (see providers/google/gemini-client.ts#wrapGeminiError).
 */
export class NoAvailableGoogleAccountError extends Error {
  constructor(
    userId: string,
    readonly reason: "none-connected" | "none-active" | "all-over-quota" = "all-over-quota",
    detail?: string,
  ) {
    super(REASON_MESSAGES[reason] + (detail ? ` (${detail})` : ""));
    this.name = "NoAvailableGoogleAccountError";
    this.userId = userId;
  }
  userId: string;
}

const REASON_MESSAGES: Record<"none-connected" | "none-active" | "all-over-quota", string> = {
  "none-connected":
    "No Google account is connected. Open Account Manager and connect one — this is not a quota problem, " +
    "and waiting will not fix it.",
  "none-active":
    "Every connected Google account is switched off or in an error state. Open Account Manager and " +
    "reactivate one.",
  "all-over-quota":
    "Every connected Google account has reached the daily limit recorded for it. Wait for it to reset, " +
    "connect another account, or clear the limit in Account Manager.",
};

/**
 * Picks the next usable pooled Google account for a generation call (ARCHITECTURE.md §3):
 * active status, quota remaining, least-recently-used first, `isDefault` only as a tiebreak.
 * Never called with a specific account fixed — every AI provider call goes through this so
 * quota is automatically spread across the pool and exhausted accounts are skipped.
 */
export async function selectGoogleAccount(userId: string): Promise<HydratedDocument<GoogleAccountDoc>> {
  await connectToDatabase();

  const filter = {
    userId,
    status: "active",
    $or: [{ "quota.dailyLimit": 0 }, { $expr: { $lt: ["$quota.used", "$quota.dailyLimit"] } }],
  };

  // Find-then-save let two concurrent queue ticks pick the same least-recently-used account and
  // both dispatch against it, defeating the pool's purpose of spreading quota. findOneAndUpdate
  // makes the "pick + claim" a single atomic Mongo operation instead.
  const candidateId = await GoogleAccount.findOne(filter).sort({ isDefault: -1, lastUsedAt: 1 }).select("_id").lean();
  if (!candidateId) {
    // Which of the three it is costs one more query, and only on the failure path. Worth it: the
    // three have nothing in common except that no account came back, and the fix for each is
    // different.
    throw await explainEmptyPool(userId);
  }

  const candidate = await GoogleAccount.findOneAndUpdate(
    { _id: candidateId._id, ...filter },
    { $set: { lastUsedAt: new Date() } },
    { new: true },
  );

  // The account may have been claimed, disabled, or exhausted by a concurrent call between the
  // lookup and the claim above; fall through to a plain retry rather than fail the whole job.
  if (!candidate) {
    const fallback = await GoogleAccount.findOneAndUpdate(filter, { $set: { lastUsedAt: new Date() } }, {
      new: true,
      sort: { isDefault: -1, lastUsedAt: 1 },
    });
    if (!fallback) throw new NoAvailableGoogleAccountError(userId);
    return fallback;
  }

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

/** Names the actual reason the pool came back empty, so the caller can say something true. */
async function explainEmptyPool(userId: string): Promise<NoAvailableGoogleAccountError> {
  const accounts = await GoogleAccount.find({ userId }).select("status quota.used quota.dailyLimit").lean();

  if (accounts.length === 0) return new NoAvailableGoogleAccountError(userId, "none-connected");

  const active = accounts.filter((a) => a.status === "active");
  if (active.length === 0) {
    const statuses = [...new Set(accounts.map((a) => a.status ?? "unknown"))].join(", ");
    return new NoAvailableGoogleAccountError(userId, "none-active", `status: ${statuses}`);
  }

  const worst = active
    .map((a) => `${a.quota?.used ?? 0}/${a.quota?.dailyLimit ?? 0}`)
    .join(", ");
  return new NoAvailableGoogleAccountError(userId, "all-over-quota", `used/limit: ${worst}`);
}

/**
 * Returns accounts to the pool once their cool-down has passed.
 *
 * Also recovers an account marked `quota_exceeded` with no `resetsAt` at all. Such a row matches no
 * time comparison, so the original filter skipped it on every sweep, forever: the account was out
 * of rotation permanently and the only way back was a human clicking Reactivate. A lockout with no
 * expiry is not a cool-down, and nothing in this system is allowed to be unrecoverable by itself.
 */
export async function reactivateExpiredQuotas(): Promise<number> {
  await connectToDatabase();
  const result = await GoogleAccount.updateMany(
    {
      status: "quota_exceeded",
      $or: [{ "quota.resetsAt": { $lte: new Date() } }, { "quota.resetsAt": { $exists: false } }, { "quota.resetsAt": null }],
    },
    { $set: { status: "active", "quota.used": 0 }, $unset: { "quota.resetsAt": "" } },
  );
  return result.modifiedCount;
}

export async function recordAccountUsage(accountId: string): Promise<void> {
  await connectToDatabase();
  await GoogleAccount.updateOne({ _id: accountId }, { $inc: { "quota.used": 1 } });
}
