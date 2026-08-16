import type { Job as BullJob } from "bullmq";
import { withJobLifecycle, type BullJobData, type ProcessorResult } from "./helpers";
import { getInstagramAccountById, getDecryptedPageAccessToken, logInstagramMessage } from "@/modules/instagram/service";
import { sendInstagramMessage } from "@/core/instagram/graph-api";
import { resolveGenerationAccount } from "@/modules/accounts/service";
import { recordAccountUsage } from "@/modules/accounts/selector";
import { resolveActiveTemplate } from "@/modules/prompt-templates/service";
import { generateInstagramReply } from "@/core/ai/providers/google/gemini-text-reply";

interface InstagramReplyPayload {
  instagramAccountId: string;
  senderId: string;
  incomingText: string;
  messageId: string;
}

/**
 * Drafts (Gemini) and sends (Meta Send API) an auto-reply to one inbound Instagram DM. Enqueued by
 * the webhook route (src/app/api/webhooks/instagram/route.ts) for every real inbound text message —
 * kept out of the webhook handler itself so Meta's fast-response requirement doesn't have to wait
 * on a Gemini call plus a second Graph API round trip.
 */
export async function processInstagramReplyJob(bullJob: BullJob<BullJobData>): Promise<ProcessorResult> {
  return withJobLifecycle(bullJob, async (jobDoc) => {
    const payload = jobDoc.payload as unknown as InstagramReplyPayload;
    const account = await getInstagramAccountById(jobDoc.userId, payload.instagramAccountId);
    if (!account) throw new Error("Instagram account not found or disconnected");

    // Checked again here (not just at webhook-receive time): auto-reply could have been switched
    // off between the message arriving and this job running.
    if (!account.autoReplyEnabled) {
      await logInstagramMessage(jobDoc.userId, account._id.toString(), {
        senderId: payload.senderId,
        incomingText: payload.incomingText,
        status: "skipped",
      });
      return { skipped: true, reason: "auto-reply disabled" };
    }

    try {
      const { accountId, context } = await resolveGenerationAccount(jobDoc.userId);
      const templateOverride = await resolveActiveTemplate(jobDoc.userId, "instagram_reply");
      const replyText = await generateInstagramReply(
        { businessName: account.name || account.username, incomingMessage: payload.incomingText, templateOverride },
        context,
      );
      await recordAccountUsage(accountId);

      const pageAccessToken = await getDecryptedPageAccessToken(jobDoc.userId, payload.instagramAccountId);
      if (!pageAccessToken) throw new Error("Instagram page access token could not be decrypted");
      await sendInstagramMessage({ pageAccessToken, recipientId: payload.senderId, text: replyText });

      await logInstagramMessage(jobDoc.userId, account._id.toString(), {
        senderId: payload.senderId,
        incomingText: payload.incomingText,
        replyText,
        status: "replied",
      });

      return { replyText };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logInstagramMessage(jobDoc.userId, account._id.toString(), {
        senderId: payload.senderId,
        incomingText: payload.incomingText,
        status: "failed",
        error: message,
      });
      throw err; // rethrow so withJobLifecycle/BullMQ's own retry+failed bookkeeping still applies
    }
  });
}
