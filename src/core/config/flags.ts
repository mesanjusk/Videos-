/**
 * Feature flags for everything the merge added.
 *
 * The rule every default here follows: **a deployment that pulls this merge and changes no
 * environment variable must behave exactly as it did before.** Golden Rule 15. So every new
 * *integration* is off unless its service is configured, and every new *capability* defaults to
 * the behaviour that was already in place.
 *
 * A flag being on never means "this works" — it means "you may try". A provider whose flag is on
 * but whose URL or key is missing reports itself unavailable rather than throwing at import time
 * or failing a build. `describeFlags()` is what the System Health page renders, so an operator can
 * see the difference between "switched off" and "switched on but not configured".
 */

function flag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  return raw === "1" || raw.toLowerCase() === "true";
}

export interface FeatureFlags {
  /** Whether a run may select the ZERO_COST policy at all. */
  zeroCostMode: boolean;
  /** Route LLM traffic through an OmniRoute-compatible gateway when one is configured. */
  omniRoute: boolean;
  /** Offer Voicebox as a local, non-metered VoiceProvider. */
  voicebox: boolean;
  /** Offer HyperFrames as a RenderProvider alongside FFmpeg. Never instead of it. */
  hyperframes: boolean;
  /** Offer Ideogram as an ImageProvider for text-heavy images. */
  ideogram: boolean;
  /** Offer a local image/TTS worker over HTTP (Easy Diffusion or anything speaking the same shape). */
  localAi: boolean;
  /** Let a video stage divert to browser automation when no API route is available. */
  browserFallback: boolean;
}

export function getFeatureFlags(): FeatureFlags {
  return {
    // Defaults true, and that is still a safe default: selecting ZERO_COST is opt-in per run or
    // per production profile, so a deployment that never selects it is unaffected. Flagging the
    // *availability* off by default would only mean an operator who wants the safety rail has to
    // find a second switch first. Set ENABLE_ZERO_COST_MODE=false to forbid it outright.
    zeroCostMode: flag("ENABLE_ZERO_COST_MODE", true),

    // These four each front an external service this deployment may not have. Off by default —
    // turning one on without configuring it changes nothing except that System Health starts
    // reporting it as "enabled, not configured".
    omniRoute: flag("ENABLE_OMNIROUTE", false),
    voicebox: flag("ENABLE_VOICEBOX", false),
    hyperframes: flag("ENABLE_HYPERFRAMES", false),
    ideogram: flag("ENABLE_IDEOGRAM", false),
    localAi: flag("ENABLE_LOCAL_AI", false),

    // Off by default because it changes what an existing job does: a scene_video job that would
    // have handed off to a human might instead drive a browser. That is a behaviour change, and
    // behaviour changes are opt-in.
    browserFallback: flag("ENABLE_BROWSER_FALLBACK", false),
  };
}

export interface FlagReport {
  flag: keyof FeatureFlags;
  enabled: boolean;
  /** Whether the thing behind the flag is actually usable right now. */
  configured: boolean;
  /** What is missing, when it is enabled but not configured. */
  missing?: string[];
}

/** Renders the enabled-vs-configured distinction the System Health page needs. */
export function describeFlags(): FlagReport[] {
  const flags = getFeatureFlags();
  const check = (name: keyof FeatureFlags, required: string[]): FlagReport => {
    const missing = required.filter((key) => !process.env[key]);
    return { flag: name, enabled: flags[name], configured: missing.length === 0, missing: missing.length ? missing : undefined };
  };

  return [
    { flag: "zeroCostMode", enabled: flags.zeroCostMode, configured: true },
    check("omniRoute", ["OMNIROUTE_BASE_URL"]),
    check("voicebox", ["VOICEBOX_URL"]),
    { flag: "hyperframes", enabled: flags.hyperframes, configured: true },
    check("ideogram", ["IDEOGRAM_API_KEY"]),
    check("localAi", ["LOCAL_AI_IMAGE_URL"]),
    { flag: "browserFallback", enabled: flags.browserFallback, configured: true },
  ];
}
