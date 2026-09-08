import type { HydratedDocument } from "mongoose";
import type { JobDoc } from "@/modules/jobs/models/Job";
import type { GeneratedImage, ImageProvider } from "@/core/ai/types";
import { ProviderQuotaExceededError } from "@/core/ai/types";
import { getImageProvider, BROWSER_IMAGE_PROVIDER_ID } from "@/core/ai/registry";
import { PROVIDER_METADATA, isProviderConfigured } from "@/core/ai/provider-metadata";
import { markModelUnavailable, isModelUnavailable } from "@/core/ai/provider-health";
import { resolveFlowImages, FlowMissionPendingError, type FlowImageRequest, type FlowImageOptions } from "./flow-image-step";
import { findAccountWithFlowSession } from "@/modules/accounts/service";

/**
 * Which route draws an image, and what happens when it cannot.
 *
 * Every image step used to name one provider, call it, and fail the job if that call failed. That
 * is fine while the named provider works and catastrophic the moment it cannot: this deployment
 * spent a week unable to produce anything because one image model answers `limit: 0` — a refusal
 * that no retry, and no amount of waiting, will ever turn into a picture.
 *
 * A single configured provider is a single point of failure, and it does not need to be. The
 * registry already knows several image routes; the cost policy already knows how to order them.
 * So this asks the configured one first and, when it is *structurally* unable to serve, moves to
 * the next and records why — rather than handing the user an error and stopping.
 *
 * ## What counts as moving on
 *
 * Only a failure that says "this will never work": a provider with no allowance for its model, or
 * one that is not configured at all. A timeout, a 503, a bad prompt or a network blip is not that
 * — those are retried against the same provider by the queue, which is where retries belong.
 * Falling through on a transient error would silently spread one project's work across every
 * provider a deployment has, which is how a free-tier account quietly becomes a paid one.
 */

export interface ImageRouteRequest {
  /** Already-composed prompts, keyed. One entry for a single image; one per pose for a sheet. */
  prompts: FlowImageRequest[];
  /**
   * Runs an API-backed provider. The processors keep their own structured inputs, so this is how
   * they hand back a result without every input type leaking into the router.
   */
  viaApi: (provider: ImageProvider) => Promise<Record<string, GeneratedImage>>;
  flow: FlowImageOptions;
  /** The provider the user or environment asked for. Tried first when it can serve. */
  preferredProviderId?: string | null;
}

/**
 * Whether the browser route can actually run for this user.
 *
 * It declares no environment requirements — there is no key to set — so `isProviderConfigured` says
 * yes for every deployment, which would quietly make it the fallback everywhere. Without a
 * connected Flow session there is nothing to sign in as, the extension has no mission it can
 * execute, and the job would park forever waiting on one. That is precisely the failure that left
 * every video in this studio queued against a worker that did not exist; it is not worth repeating
 * one capability over.
 */
async function browserRouteUsable(userId: string): Promise<boolean> {
  const account = await findAccountWithFlowSession(userId).catch(() => null);
  return account !== null;
}

/** The image model a provider would use, for the health record — Gemini's is the one that varies. */
function modelFor(providerId: string): string | undefined {
  return providerId === "gemini" ? (process.env.GEMINI_IMAGE_MODEL ?? "gemini-2.5-flash-image") : undefined;
}

/**
 * Image providers this deployment could actually use, best first.
 *
 * Order: what was asked for, then the registry's own order for the capability. Unconfigured
 * providers are dropped here rather than discovered mid-run — a missing key is knowable up front.
 */
export async function imageRouteCandidates(userId: string, preferredProviderId?: string | null): Promise<string[]> {
  const registered = PROVIDER_METADATA.filter((d) => d.capability === "image" && isProviderConfigured(d)).map((d) => d.id);

  // With nothing explicitly chosen, the browser route goes first.
  //
  // This studio's product is Google Flow: characters, backgrounds and scene stills are drawn there
  // and then handed to Flow's own video generation as reference material. An image API was never
  // the point — it was the default only because the pipeline was assembled API-first, which is how
  // a deployment whose whole visual route is a browser ended up dead over an image model's free
  // tier. When a Flow session exists, it is the answer.
  const ordered = preferredProviderId
    ? [preferredProviderId, ...registered.filter((id) => id !== preferredProviderId)]
    : [BROWSER_IMAGE_PROVIDER_ID, ...registered.filter((id) => id !== BROWSER_IMAGE_PROVIDER_ID)];

  const usable: string[] = [];
  for (const id of ordered) {
    if (id === BROWSER_IMAGE_PROVIDER_ID) {
      if (await browserRouteUsable(userId)) usable.push(id);
      continue;
    }
    // A provider named explicitly but never registered is a configuration mistake worth surfacing
    // rather than silently ignoring, so it stays in the list and fails loudly on use.
    const known = registered.includes(id);
    if (known && (await isModelUnavailable(id, modelFor(id)))) continue;
    usable.push(id);
  }
  return usable;
}

/** True for the failures that mean "never, on this configuration" rather than "not this time". */
function isStructuralRefusal(err: unknown): err is ProviderQuotaExceededError {
  return err instanceof ProviderQuotaExceededError && err.detail?.allowanceIsZero === true;
}

export async function routeImages(
  jobDoc: HydratedDocument<JobDoc>,
  request: ImageRouteRequest,
): Promise<Record<string, GeneratedImage>> {
  const candidates = await imageRouteCandidates(jobDoc.userId, request.preferredProviderId);
  if (candidates.length === 0) {
    throw new Error(
      "No image provider is configured. Set GEMINI_API_KEY, connect a Google account, or enable one of " +
        "ENABLE_LOCAL_AI (LOCAL_AI_IMAGE_URL), ENABLE_IDEOGRAM (IDEOGRAM_API_KEY), or the Google Flow browser route.",
    );
  }

  const refused: string[] = [];

  for (const providerId of candidates) {
    try {
      if (providerId === BROWSER_IMAGE_PROVIDER_ID) {
        // Parks the job rather than blocking; FlowMissionPendingError is not a failure and must
        // reach the lifecycle untouched, so it is deliberately not caught below.
        return await resolveFlowImages(jobDoc, request.prompts, request.flow);
      }
      return await request.viaApi(getImageProvider(providerId));
    } catch (err) {
      if (err instanceof FlowMissionPendingError) throw err;

      if (isStructuralRefusal(err)) {
        const model = err.detail?.model ?? modelFor(providerId);
        await markModelUnavailable(providerId, model, err.message);
        refused.push(`${providerId}${model ? ` (${model})` : ""}`);
        continue;
      }

      // Everything else belongs to this provider and to the queue's retry, not to the next
      // provider in the list.
      throw err;
    }
  }

  throw new Error(
    `Every image provider refused this request outright: ${refused.join(", ")}. ` +
      "These are not exhausted quotas — the models are not available on this configuration. " +
      "Enable billing, choose a different model, or switch the image provider in Settings.",
  );
}

/**
 * The single-image case, which is three of the four image steps.
 *
 * A thin wrapper rather than a second implementation: the batch machinery is what handles a
 * character sheet's ten poses, and one image is that with one entry. This only spares every caller
 * the same key lookup and the same "can it really be undefined" question.
 */
export async function routeSingleImage(
  jobDoc: HydratedDocument<JobDoc>,
  request: Omit<ImageRouteRequest, "prompts" | "viaApi"> & {
    prompt: string;
    referenceUrls?: string[];
    viaApi: (provider: ImageProvider) => Promise<GeneratedImage>;
  },
): Promise<GeneratedImage> {
  const key = "image";
  const images = await routeImages(jobDoc, {
    preferredProviderId: request.preferredProviderId,
    prompts: [{ key, prompt: request.prompt, referenceUrls: request.referenceUrls }],
    viaApi: async (provider) => ({ [key]: await request.viaApi(provider) }),
    flow: request.flow,
  });

  const image = images[key];
  if (!image) throw new Error("The image route returned no image for this request.");
  return image;
}
