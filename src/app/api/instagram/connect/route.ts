import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { encryptSecret } from "@/core/auth/encryption";
import { getFacebookOAuthUrl } from "@/core/instagram/graph-api";

export const dynamic = "force-dynamic";

/**
 * Starts the Facebook OAuth consent flow — Instagram messaging has no standalone OAuth, it's only
 * reachable through a linked Facebook Page's own login (see core/instagram/graph-api.ts). `state`
 * carries the app userId through Meta's redirect (the callback has no session to read it from) as
 * AES-256-GCM ciphertext rather than a plain value + a separately-stored nonce — tamper-proof
 * without needing a cookie to survive the round trip through Meta's domain.
 */
export async function GET() {
  try {
    const userId = await requireUserId();
    const state = encryptSecret(JSON.stringify({ userId, nonce: randomBytes(16).toString("hex") }));
    return NextResponse.redirect(getFacebookOAuthUrl(state));
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const message = err instanceof Error ? err.message : "Failed to start Instagram connect flow";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
