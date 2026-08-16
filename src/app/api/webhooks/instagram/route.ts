import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/core/instagram/graph-api";
import { findAccountByInstagramUserId } from "@/modules/instagram/service";
import { enqueueJob } from "@/modules/jobs/service";

export const dynamic = "force-dynamic";

interface InstagramWebhookBody {
  object?: string;
  entry?: {
    id: string;
    messaging?: {
      sender: { id: string };
      recipient: { id: string };
      message?: { mid: string; text?: string; is_echo?: boolean };
    }[];
  }[];
}

/** Meta's one-time subscription-verification handshake, run when the webhook URL is configured in
 * the App Dashboard. Must echo `hub.challenge` back verbatim if `hub.verify_token` matches. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && challenge && token === process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

/**
 * Receives every inbound Instagram messaging event for every connected account across every user —
 * this is Meta's one app-wide webhook URL, not a per-user route (see
 * modules/instagram/service.ts#findAccountByInstagramUserId for why that lookup is deliberately
 * unscoped). Must respond fast: Meta retries/backs off on slow or erroring endpoints, so this only
 * verifies the signature, does a couple of quick lookups, and enqueues an `instagram_reply` job —
 * the Gemini call and the Send API reply happen in the queue processor, same
 * "validate → enqueue → 202/200" shape as every generation route in this app.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifyWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: InstagramWebhookBody;
  try {
    body = JSON.parse(rawBody) as InstagramWebhookBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Meta always expects a 200 for anything it didn't reject outright (a non-200 counts as a
  // delivery failure and gets retried) — an object we don't handle, or an event type we skip, are
  // both "acknowledged, nothing to do", not errors.
  if (body.object !== "instagram") return NextResponse.json({ ok: true });

  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const message = event.message;
      // Skip echoes (our own outbound replies bounced back through the same webhook — replying to
      // those would loop forever) and anything without text (attachments, reactions, read
      // receipts, story mentions) — nothing there to draft a reply to.
      if (!message?.text || message.is_echo) continue;

      const account = await findAccountByInstagramUserId(event.recipient.id);
      if (!account) continue; // an IG account we don't have connected — not our data to act on

      await enqueueJob({
        userId: account.userId,
        type: "instagram_reply",
        payload: {
          instagramAccountId: account._id.toString(),
          senderId: event.sender.id,
          incomingText: message.text,
          messageId: message.mid,
        },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
