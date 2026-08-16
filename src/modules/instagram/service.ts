import { connectToDatabase } from "@/core/db/mongoose";
import { encryptSecret, decryptSecret } from "@/core/auth/encryption";
import { InstagramAccount } from "./models/InstagramAccount";
import { InstagramMessage } from "./models/InstagramMessage";
import type { ConnectedInstagramPage } from "@/core/instagram/graph-api";

export async function listInstagramAccounts(userId: string) {
  await connectToDatabase();
  return InstagramAccount.find({ userId }).select("-credentials").sort({ createdAt: 1 }).lean();
}

export async function getInstagramAccountById(userId: string, accountId: string) {
  await connectToDatabase();
  return InstagramAccount.findOne({ _id: accountId, userId });
}

/**
 * Webhook events carry only the IG business account id Meta is messaging on behalf of
 * (`entry[].messaging[].recipient.id`) — never our app's userId. This is the one legitimate,
 * intentional exception to "every query is scoped by userId" (docs/api-reference.md's opening
 * line): the app-wide webhook endpoint has to resolve which user owns a given IG account before
 * anything else can be scoped.
 */
export async function findAccountByInstagramUserId(instagramUserId: string) {
  await connectToDatabase();
  return InstagramAccount.findOne({ instagramUserId, status: "active" });
}

/**
 * Called once per connected Page after the OAuth callback — upserts on `{userId, instagramUserId}`
 * so reconnecting (e.g. after a token refresh) updates the existing row instead of duplicating it.
 */
export async function upsertInstagramAccount(userId: string, page: ConnectedInstagramPage) {
  await connectToDatabase();
  return InstagramAccount.findOneAndUpdate(
    { userId, instagramUserId: page.instagramUserId },
    {
      $set: {
        username: page.username,
        name: page.name,
        profilePictureUrl: page.profilePictureUrl,
        pageId: page.pageId,
        pageName: page.pageName,
        "credentials.pageAccessTokenEnc": encryptSecret(page.pageAccessToken),
        status: "active",
      },
      $setOnInsert: { autoReplyEnabled: false },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export async function setAutoReplyEnabled(userId: string, accountId: string, enabled: boolean) {
  await connectToDatabase();
  return InstagramAccount.findOneAndUpdate(
    { _id: accountId, userId },
    { $set: { autoReplyEnabled: enabled } },
    { new: true },
  ).select("-credentials");
}

export async function disconnectInstagramAccount(userId: string, accountId: string) {
  await connectToDatabase();
  await InstagramAccount.deleteOne({ _id: accountId, userId });
}

/** Decrypts a connected account's Page access token — only ever called from the queue processor,
 * never sent to the client. */
export async function getDecryptedPageAccessToken(userId: string, accountId: string): Promise<string | null> {
  await connectToDatabase();
  const account = await InstagramAccount.findOne({ _id: accountId, userId }).select("credentials.pageAccessTokenEnc").lean();
  const enc = account?.credentials?.pageAccessTokenEnc;
  return enc ? decryptSecret(enc) : null;
}

export interface LogInstagramMessageInput {
  senderId: string;
  incomingText: string;
  replyText?: string;
  status: "replied" | "failed" | "skipped";
  error?: string;
}

export async function logInstagramMessage(userId: string, instagramAccountId: string, input: LogInstagramMessageInput) {
  await connectToDatabase();
  return InstagramMessage.create({ userId, instagramAccountId, ...input });
}

export async function listRecentInstagramMessages(userId: string, limit = 20) {
  await connectToDatabase();
  return InstagramMessage.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
}
