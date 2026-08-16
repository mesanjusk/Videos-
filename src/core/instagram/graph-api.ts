import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta Graph API client for Instagram's official Messaging API — the ONLY Instagram integration
 * this codebase implements (ARCHITECTURE.md §18). No browser automation, no unsolicited outreach:
 * every call here either replies to a message a user sent first, or sets up the OAuth/webhook
 * plumbing that makes that possible. Instagram has no standalone OAuth for messaging — it's only
 * reachable through a linked Facebook Page's own OAuth and Graph API surface.
 *
 * UNVERIFIED against a live Meta app/Instagram account: this sandbox has no real Meta developer
 * app to test against, same "recalibrate against the real product before trusting it" caveat this
 * codebase already applies to core/automation/selectors.ts (Google Flow). Confirm endpoint
 * shapes/field names against https://developers.facebook.com/docs/instagram-platform before
 * relying on this in production.
 */

const GRAPH_API_VERSION = process.env.INSTAGRAM_GRAPH_API_VERSION || "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — see .env.example's Instagram section.`);
  return value;
}

async function parseGraphResponse<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(`Instagram Graph API request failed: ${json?.error?.message ?? res.statusText}`);
  }
  return json;
}

/** Starts the Facebook OAuth consent dialog. `state` is opaque here — the caller is responsible for
 * making it tamper-proof (see src/app/api/instagram/connect/route.ts, which encrypts it). */
export function getFacebookOAuthUrl(state: string): string {
  const clientId = requireEnv("INSTAGRAM_APP_ID");
  const redirectUri = requireEnv("INSTAGRAM_REDIRECT_URI");
  const scope = ["instagram_basic", "instagram_manage_messages", "pages_show_list", "pages_messaging"].join(",");
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, scope, response_type: "code", state });
  return `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;
}

export async function exchangeCodeForUserToken(code: string): Promise<string> {
  const params = new URLSearchParams({
    client_id: requireEnv("INSTAGRAM_APP_ID"),
    client_secret: requireEnv("INSTAGRAM_APP_SECRET"),
    redirect_uri: requireEnv("INSTAGRAM_REDIRECT_URI"),
    code,
  });
  const res = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  const json = await parseGraphResponse<{ access_token: string }>(res);
  return json.access_token;
}

/** Short-lived user tokens expire in ~1-2h; the long-lived exchange gives ~60 days, and Page
 * tokens minted from a long-lived user token effectively don't expire under normal use. */
export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: requireEnv("INSTAGRAM_APP_ID"),
    client_secret: requireEnv("INSTAGRAM_APP_SECRET"),
    fb_exchange_token: shortLivedToken,
  });
  const res = await fetch(`${GRAPH_BASE}/oauth/access_token?${params.toString()}`);
  const json = await parseGraphResponse<{ access_token: string }>(res);
  return json.access_token;
}

export interface ConnectedInstagramPage {
  pageId: string;
  pageName: string;
  pageAccessToken: string;
  instagramUserId: string;
  username: string;
  name?: string;
  profilePictureUrl?: string;
}

/** Every Facebook Page this user token can manage that also has a linked Instagram professional
 * account — a user can have several Pages, only some of which have Instagram connected. */
export async function listConnectedInstagramPages(userAccessToken: string): Promise<ConnectedInstagramPage[]> {
  const pagesRes = await fetch(
    `${GRAPH_BASE}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(userAccessToken)}`,
  );
  const pagesJson = await parseGraphResponse<{ data: { id: string; name: string; access_token: string }[] }>(pagesRes);

  const results: ConnectedInstagramPage[] = [];
  for (const page of pagesJson.data ?? []) {
    const igRes = await fetch(
      `${GRAPH_BASE}/${page.id}?fields=instagram_business_account{id,username,name,profile_picture_url}&access_token=${encodeURIComponent(page.access_token)}`,
    );
    const igJson = await parseGraphResponse<{
      instagram_business_account?: { id: string; username: string; name?: string; profile_picture_url?: string };
    }>(igRes);
    const ig = igJson.instagram_business_account;
    if (ig?.id) {
      results.push({
        pageId: page.id,
        pageName: page.name,
        pageAccessToken: page.access_token,
        instagramUserId: ig.id,
        username: ig.username,
        name: ig.name,
        profilePictureUrl: ig.profile_picture_url,
      });
    }
  }
  return results;
}

export interface SendInstagramMessageInput {
  pageAccessToken: string;
  recipientId: string;
  text: string;
}

/**
 * The Send API. Only valid within Meta's standard 24-hour messaging window after the recipient's
 * last inbound message — always true for the auto-reply flow this is used from (the reply is sent
 * immediately after receiving their message), so no message-tag handling is implemented here. If
 * this is ever reused for anything that isn't a same-session reply, that constraint needs revisiting.
 */
export async function sendInstagramMessage(input: SendInstagramMessageInput): Promise<void> {
  const res = await fetch(`${GRAPH_BASE}/me/messages?access_token=${encodeURIComponent(input.pageAccessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: input.recipientId }, message: { text: input.text } }),
  });
  await parseGraphResponse(res);
}

/**
 * HMAC-SHA256 over the raw request body, per Meta's webhook signing convention — reject anything
 * that doesn't match rather than trust an unauthenticated POST claiming to be Meta. Must be called
 * with the exact raw body bytes/string Meta signed, before any JSON parsing.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const appSecret = requireEnv("INSTAGRAM_APP_SECRET");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const provided = signatureHeader.slice("sha256=".length);

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  // timingSafeEqual throws on a length mismatch rather than returning false — a mismatched length
  // already means "not equal" without needing the constant-time comparison at all.
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
