import { getRedisConnection } from "@/core/queue/connection";

/**
 * Whether a Chrome extension is connected and taking Flow missions right now.
 *
 * ## Why this exists
 *
 * The image route used to ask a different question than the one that matters. It checked whether
 * some Google account had a stored Flow `storageState()` blob — and then handed the work to the
 * Chrome extension, which does not use that blob at all. The extension runs in the operator's own
 * browser, with the operator's own Google login; the stored session belongs to the Playwright
 * runner on the worker.
 *
 * So the prerequisite was both wrong and expensive. Wrong, because a blob dumped weeks ago says
 * nothing about whether anything is listening now. Expensive, because producing one means Node,
 * Playwright and a desktop — a barrier that stood between "load an unpacked extension and log into
 * Flow" and a working image pipeline, in service of a credential nobody would read.
 *
 * What a route needs to know before it enqueues a mission is simply: *will anything pick this up?*
 * An extension that is connected and claiming answers that. A heartbeat is how it says so, and an
 * expiry is how it stops saying so when Chrome closes, the laptop sleeps, or the operator switches
 * claiming off.
 *
 * ## Shape, and why it matches the worker's
 *
 * Deliberately the same design as `core/queue/worker-presence.ts`, down to the interval and TTL:
 * one key, refreshed by whoever is alive, expiring on its own so death needs no cleanup, and
 * failing closed so an unreachable Redis reports "nothing is connected" rather than sending work
 * into a queue nobody drains. Two presence mechanisms that behave differently would be two things
 * to reason about; this is one idea applied twice.
 *
 * One key rather than one per extension: the claim endpoint hands the oldest pending mission to
 * whoever asks, with no per-operator routing, so "is any extension connected" is the only question
 * this can answer and the only one anything asks. The last extension to check in is the one named.
 */

const HEARTBEAT_KEY = "extension:heartbeat";

/** What the extension should use. Comfortably inside the TTL, so one missed ping is not death. */
export const EXTENSION_HEARTBEAT_INTERVAL_MS = 30_000;
/** How long a check-in stays valid. Expiry *is* the disconnect notice. */
export const EXTENSION_HEARTBEAT_TTL_SECONDS = 90;

export interface ExtensionPresence {
  connected: boolean;
  /** The extension instance that last checked in — its side panel shows the same id. */
  workerId?: string;
  lastSeenAt?: string;
  /** Whatever the extension told us about itself, e.g. its version. Never trusted for control flow. */
  detail?: Record<string, unknown>;
}

/**
 * Records that this extension is connected and claiming.
 *
 * Called by the heartbeat endpoint and by the claim endpoint — the second because an extension that
 * is claiming work is connected by definition, which keeps an older extension that predates the
 * heartbeat from being reported as absent while it is visibly doing the job.
 *
 * Never throws: an extension whose check-in fails has a connectivity problem its next request will
 * report anyway, and a 500 on a heartbeat would be a strange way to learn about it.
 */
export async function recordExtensionHeartbeat(workerId: string, detail?: Record<string, unknown>): Promise<void> {
  const payload = JSON.stringify({ workerId, lastSeenAt: new Date().toISOString(), detail });
  try {
    await getRedisConnection().set(HEARTBEAT_KEY, payload, "EX", EXTENSION_HEARTBEAT_TTL_SECONDS);
  } catch (err) {
    console.error(`[extension ${workerId}] heartbeat failed:`, err);
  }
}

/** Reads the check-in. Never throws — an unreachable Redis reports "not connected", the safe answer. */
export async function getExtensionPresence(): Promise<ExtensionPresence> {
  try {
    const raw = await getRedisConnection().get(HEARTBEAT_KEY);
    if (!raw) return { connected: false };
    const parsed = JSON.parse(raw) as Omit<ExtensionPresence, "connected">;
    return { connected: true, ...parsed };
  } catch {
    return { connected: false };
  }
}

export async function isExtensionConnected(): Promise<boolean> {
  return (await getExtensionPresence()).connected;
}

/** Clears the check-in, so switching claiming off is known at once rather than in 90 seconds. */
export async function clearExtensionHeartbeat(): Promise<void> {
  try {
    await getRedisConnection().del(HEARTBEAT_KEY);
  } catch {
    // Nothing to do: the key expires on its own.
  }
}
