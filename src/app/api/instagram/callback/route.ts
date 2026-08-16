import { NextResponse } from "next/server";
import { decryptSecret } from "@/core/auth/encryption";
import { exchangeCodeForUserToken, exchangeForLongLivedToken, listConnectedInstagramPages } from "@/core/instagram/graph-api";
import { upsertInstagramAccount } from "@/modules/instagram/service";

export const dynamic = "force-dynamic";

/** Facebook OAuth redirect target — exchanges the auth code for a Page-scoped access token per
 * connected Instagram professional account, then redirects back into the app's own /instagram page. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error_description") ?? url.searchParams.get("error");

  if (oauthError) return NextResponse.redirect(new URL(`/instagram?error=${encodeURIComponent(oauthError)}`, request.url));
  if (!code || !state) return NextResponse.redirect(new URL("/instagram?error=missing_code", request.url));

  let userId: string;
  try {
    ({ userId } = JSON.parse(decryptSecret(state)) as { userId: string; nonce: string });
  } catch {
    return NextResponse.redirect(new URL("/instagram?error=invalid_state", request.url));
  }

  try {
    const shortLivedToken = await exchangeCodeForUserToken(code);
    const longLivedToken = await exchangeForLongLivedToken(shortLivedToken);
    const pages = await listConnectedInstagramPages(longLivedToken);

    if (pages.length === 0) {
      return NextResponse.redirect(new URL("/instagram?error=no_instagram_page", request.url));
    }

    // A user can have several Facebook Pages with Instagram connected — store all of them rather
    // than guessing which one they meant; they're distinguished by username in the UI.
    for (const page of pages) {
      await upsertInstagramAccount(userId, page);
    }

    return NextResponse.redirect(new URL("/instagram?connected=1", request.url));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.redirect(new URL(`/instagram?error=${encodeURIComponent(message)}`, request.url));
  }
}
