import type { Job as BullJob } from "bullmq";
import { withJobLifecycle, type BullJobData, type ProcessorResult } from "./helpers";
import { deliverWebhook } from "@/core/automation/webhook-delivery";
import { decryptSecret } from "@/core/security/encryption";
import { Webhook } from "@/modules/automation/models/Webhook";

/**
 * Delivers one outbound webhook. HTTP only — no Playwright — so unlike the workflow processor this
 * one lives in the shared registry and runs on Vercel's queue tick as well as on the worker.
 *
 * Retries are BullMQ's (5 attempts, exponential backoff): a webhook receiver returning 5xx is the
 * textbook case for queue-level retry, the opposite of the workflow job next door.
 */
export async function processAutomationWebhookJob(bullJob: BullJob<BullJobData>): Promise<ProcessorResult> {
  return withJobLifecycle(bullJob, async (jobDoc) => {
    const payload = jobDoc.payload as { url?: string; body?: Record<string, unknown>; webhookId?: string } | undefined;
    if (!payload?.url) throw new Error("automation_webhook job is missing payload.url");

    let secret: string | undefined;
    if (payload.webhookId) {
      const hook = await Webhook.findOne({ _id: payload.webhookId, userId: jobDoc.userId }).select("+secretEnc").lean();
      if (hook?.secretEnc) secret = decryptSecret(hook.secretEnc);
    }

    try {
      const result = await deliverWebhook(payload.url, payload.body ?? {}, secret);
      if (payload.webhookId) {
        await Webhook.updateOne(
          { _id: payload.webhookId, userId: jobDoc.userId },
          { lastDeliveryAt: new Date(), lastDeliveryStatus: "success", lastDeliveryError: undefined },
        );
      }
      return { status: "completed", httpStatus: result.status };
    } catch (err) {
      if (payload.webhookId) {
        await Webhook.updateOne(
          { _id: payload.webhookId, userId: jobDoc.userId },
          { lastDeliveryAt: new Date(), lastDeliveryStatus: "failed", lastDeliveryError: err instanceof Error ? err.message : String(err) },
        );
      }
      throw err;
    }
  });
}
