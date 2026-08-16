import { randomBytes, createHash } from "node:crypto";
import { connectToDatabase } from "@/core/db/mongoose";
import { ApiToken } from "./models/ApiToken";
import type { CreateApiTokenInput } from "./schema";

const TOKEN_PREFIX = "cartoon_";

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export async function listApiTokens(userId: string) {
  await connectToDatabase();
  return ApiToken.find({ userId }).select("-tokenHash").sort({ createdAt: -1 }).lean();
}

/**
 * Returns the raw token exactly once — callers must show/copy it immediately and never re-fetch it
 * (only `tokenHash` is persisted). Mirrors the GitHub/Stripe personal-access-token UX.
 */
export async function createApiToken(userId: string, input: CreateApiTokenInput) {
  await connectToDatabase();
  const secret = randomBytes(32).toString("hex");
  const rawToken = `${TOKEN_PREFIX}${secret}`;
  const doc = await ApiToken.create({
    userId,
    name: input.name,
    tokenHash: hashToken(rawToken),
    tokenPrefix: rawToken.slice(0, TOKEN_PREFIX.length + 8),
  });
  return { token: rawToken, record: { id: doc._id.toString(), name: doc.name, tokenPrefix: doc.tokenPrefix, createdAt: doc.createdAt } };
}

export async function revokeApiToken(userId: string, id: string): Promise<void> {
  await connectToDatabase();
  await ApiToken.deleteOne({ _id: id, userId });
}

/** Returns the owning userId for a valid, non-revoked raw token, or null. Updates `lastUsedAt`
 * best-effort (never blocks/fails the caller's request on that write). */
export async function verifyApiToken(rawToken: string): Promise<string | null> {
  if (!rawToken.startsWith(TOKEN_PREFIX)) return null;
  await connectToDatabase();
  const doc = await ApiToken.findOne({ tokenHash: hashToken(rawToken) }).select("userId").lean();
  if (!doc) return null;
  ApiToken.updateOne({ _id: doc._id }, { lastUsedAt: new Date() }).catch(() => {});
  return doc.userId;
}
