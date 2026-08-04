import { connectToDatabase } from "@/core/db/mongoose";
import { GoogleAccount } from "./models/GoogleAccount";
import { encryptSecret } from "@/core/auth/encryption";
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
