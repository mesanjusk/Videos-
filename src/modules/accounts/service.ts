import { connectToDatabase } from "@/core/db/mongoose";
import { GoogleAccount } from "./models/GoogleAccount";
import { encryptSecret, decryptSecret } from "@/core/auth/encryption";
import type { GenerationAccountContext } from "@/core/ai/types";
import { selectGoogleAccount, decryptAccountApiKey } from "./selector";

export interface AddGoogleAccountInput {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  apiKey: string;
}

export async function listGoogleAccounts(userId: string) {
  await connectToDatabase();
  // credentials.flowSessionStateEnc is excluded (like apiKeyEnc) — flowSessionConnectedAt alone is
  // enough for the UI to show a connected/not-connected badge without ever sending the ciphertext.
  return GoogleAccount.find({ userId }).select("-credentials").sort({ isDefault: -1, createdAt: 1 }).lean();
}

export async function addGoogleAccount(input: AddGoogleAccountInput) {
  await connectToDatabase();
  const isFirst = (await GoogleAccount.countDocuments({ userId: input.userId })) === 0;
  return GoogleAccount.create({
    userId: input.userId,
    email: input.email,
    displayName: input.displayName,
    avatarUrl: input.avatarUrl,
    credentials: { apiKeyEnc: encryptSecret(input.apiKey) },
    isDefault: isFirst,
    status: "active",
  });
}

export async function setAccountStatus(userId: string, accountId: string, status: "active" | "disabled") {
  await connectToDatabase();
  // Re-activating clears the quota tracking too — otherwise flipping a quota_exceeded account back
  // to "active" from the UI would leave stale quota.used/resetsAt behind, and selectGoogleAccount()
  // (which only checks `status`, not these fields directly) would work anyway, but the account's
  // quota display would keep showing the old exhausted numbers.
  await GoogleAccount.updateOne(
    { _id: accountId, userId },
    status === "active"
      ? { $set: { status, "quota.used": 0 }, $unset: { "quota.resetsAt": "" } }
      : { $set: { status } },
  );
}

export async function setDefaultAccount(userId: string, accountId: string) {
  await connectToDatabase();
  await GoogleAccount.updateMany({ userId }, { $set: { isDefault: false } });
  await GoogleAccount.updateOne({ _id: accountId, userId }, { $set: { isDefault: true } });
}

export async function removeGoogleAccount(userId: string, accountId: string) {
  await connectToDatabase();
  await GoogleAccount.deleteOne({ _id: accountId, userId });
}

/**
 * Stores this account's Google Flow browser session (a Playwright `storageState()` export from a
 * browser where the operator manually logged in once) so the Browser Automation Engine can reuse
 * it — encrypted the same way as the Gemini API key, never sent back to the client. We deliberately
 * never automate the login itself; this is the one-time manual step that makes automation possible
 * afterward. `storageStateJson` is validated by the caller's Zod schema, not here.
 */
export async function saveFlowSessionState(userId: string, accountId: string, storageStateJson: string) {
  await connectToDatabase();
  await GoogleAccount.updateOne(
    { _id: accountId, userId },
    { $set: { "credentials.flowSessionStateEnc": encryptSecret(storageStateJson), flowSessionConnectedAt: new Date() } },
  );
}

export async function clearFlowSessionState(userId: string, accountId: string) {
  await connectToDatabase();
  await GoogleAccount.updateOne(
    { _id: accountId, userId },
    { $unset: { "credentials.flowSessionStateEnc": "", flowSessionConnectedAt: "" } },
  );
}

/**
 * Decrypts a connected account's Flow session for the Browser Automation Engine. Only ever called
 * from worker-only code (core/queue/worker-only-processors.ts via worker.ts) — never from a route
 * or anything reachable from the Next.js/Vercel bundle.
 */
export async function getDecryptedFlowSessionState(userId: string, accountId: string): Promise<string | null> {
  await connectToDatabase();
  const account = await GoogleAccount.findOne({ _id: accountId, userId }).select("credentials.flowSessionStateEnc").lean();
  const enc = account?.credentials?.flowSessionStateEnc;
  return enc ? decryptSecret(enc) : null;
}

/**
 * The one active account with a connected Flow browser session, preferring the default account —
 * separate from `selectGoogleAccount`'s quota-based rotation (browser sessions aren't a Gemini-API
 * quota concern). Returns null if the user hasn't connected any account's Flow session yet, which
 * callers treat as "automation unavailable, use the manual hand-off."
 */
export async function findAccountWithFlowSession(userId: string): Promise<{ accountId: string } | null> {
  await connectToDatabase();
  const account = await GoogleAccount.findOne({ userId, status: "active", flowSessionConnectedAt: { $exists: true } })
    .sort({ isDefault: -1, flowSessionConnectedAt: -1 })
    .select("_id")
    .lean();
  return account ? { accountId: account._id.toString() } : null;
}

/**
 * The single entry point every AI provider call should use to get a `GenerationAccountContext`.
 * Resolves the next usable pooled account and decrypts its API key — callers must still handle
 * `NoAvailableGoogleAccountError` (no active account with quota) and `ProviderQuotaExceededError`
 * thrown mid-call by marking that account exhausted and retrying against a different one
 * (this rotation-and-retry is implemented in the queue processors, see ARCHITECTURE.md §7).
 */
export async function resolveGenerationAccount(userId: string): Promise<{
  accountId: string;
  context: GenerationAccountContext;
}> {
  const account = await selectGoogleAccount(userId);
  return {
    accountId: account._id.toString(),
    context: { googleAccountId: account._id.toString(), apiKey: decryptAccountApiKey(account) },
  };
}
