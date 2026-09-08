import { getRedisConnection } from "@/core/queue/connection";

/**
 * What this deployment has learned about a provider from actually calling it.
 *
 * There is a difference between a call that failed and a call that *cannot* succeed. When Gemini
 * answers `limit: 0` for a model, that is not weather — it is a fact about this key: the model is
 * not on its free tier, and every subsequent request will be refused identically until someone
 * changes the billing or the model. Rediscovering that on every job means a wasted request, a
 * failed step and an identical error, forever.
 *
 * So it is remembered, and the router skips a provider that is known to be structurally unable to
 * serve. That is the whole difference between a studio that stops when one model is unavailable and
 * one that carries on with another.
 *
 * ## Why it expires
 *
 * A day, not forever. The condition is fixed from this application's side but not from the
 * operator's: enabling billing, or moving the key to another project, makes the model available
 * again and nothing in here would ever hear about it. A TTL means the system re-tests reality by
 * itself instead of needing someone to remember to clear a flag.
 *
 * ## Why it fails open
 *
 * Every read that cannot reach Redis reports "available". The cost of wrongly believing a provider
 * works is one failed call that is retried; the cost of wrongly believing it does not is refusing
 * to use a provider that would have worked. The second is worse, and silent.
 */

const KEY_PREFIX = "provider-health:unavailable:";
export const UNAVAILABLE_TTL_SECONDS = 24 * 60 * 60;

function keyFor(providerId: string, model?: string): string {
  return `${KEY_PREFIX}${providerId}:${model ?? "*"}`;
}

/**
 * Records that this provider cannot serve this model at all.
 *
 * Deliberately keyed by model as well as provider: Gemini's text model works on the very key whose
 * image model is refused, and benching the whole provider over one model is the mistake that took
 * a working text credential out of rotation in the first place.
 */
export async function markModelUnavailable(providerId: string, model: string | undefined, reason: string): Promise<void> {
  try {
    await getRedisConnection().set(keyFor(providerId, model), reason, "EX", UNAVAILABLE_TTL_SECONDS);
    console.warn(
      `[provider-health] ${providerId}${model ? ` (${model})` : ""} marked unavailable for ` +
        `${UNAVAILABLE_TTL_SECONDS / 3600}h: ${reason}`,
    );
  } catch (err) {
    // Not fatal. Losing the note costs a repeated failed call, not correctness.
    console.error(`[provider-health] could not record ${providerId} as unavailable:`, err);
  }
}

/** The recorded reason, or null when the provider is believed usable. */
export async function unavailableReason(providerId: string, model?: string): Promise<string | null> {
  try {
    return await getRedisConnection().get(keyFor(providerId, model));
  } catch {
    return null;
  }
}

export async function isModelUnavailable(providerId: string, model?: string): Promise<boolean> {
  return (await unavailableReason(providerId, model)) !== null;
}

/** Clears the note — for an operator who has just fixed the billing and does not want to wait a day. */
export async function clearModelUnavailable(providerId: string, model?: string): Promise<void> {
  try {
    await getRedisConnection().del(keyFor(providerId, model));
  } catch {
    // Nothing to do: the note expires on its own.
  }
}
