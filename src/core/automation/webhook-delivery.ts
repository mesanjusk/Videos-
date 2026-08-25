import { createHmac } from "node:crypto";

export interface WebhookDeliveryResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * Delivers one outbound webhook. Ported from Browser Automation OS, which had it and this project
 * did not (its only webhooks were inbound, from Meta).
 *
 * Signed with HMAC-SHA256 over the exact bytes sent, so a receiver can verify the call really came
 * from this deployment. Timestamped and sent in a separate header so a receiver can reject a
 * replayed body.
 *
 * The retry policy lives in BullMQ (`automation_webhook`: 5 attempts, exponential backoff), not
 * here — this function either succeeds or throws, and the queue decides what to do about it.
 */
export async function deliverWebhook(
  url: string,
  payload: Record<string, unknown>,
  secret?: string,
  opts: { timeoutMs?: number } = {},
): Promise<WebhookDeliveryResult> {
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "ai-production-os-webhooks/1",
    "X-Webhook-Timestamp": timestamp,
  };
  if (secret) {
    headers["X-Webhook-Signature"] = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  try {
    const response = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
    if (!response.ok) {
      // Thrown, not returned: BullMQ's retry only engages on a rejection, and a 5xx from the
      // receiver is exactly the case worth retrying.
      throw new Error(`Webhook delivery to ${url} failed with HTTP ${response.status}`);
    }
    return { ok: true, status: response.status };
  } finally {
    clearTimeout(timer);
  }
}
