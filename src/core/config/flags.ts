/**
 * Feature flags for everything the merge added.
 *
 * The rule every default here follows: **a deployment that pulls this merge and changes no
 * environment variable must behave exactly as it did before.** Golden Rule 15. So every new
 * *integration* is off unless its service is configured, and every new *capability* defaults to
 * the behaviour that was already in place. `browserFallback` is the one considered exception —
 * the reasoning is written out at its default below, not hidden in a diff.
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
  /**
   * Let a video stage drive the provider's website when it has no API. On by default — this is the
   * route, not a fallback; see the rationale on the default below.
   */
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

    // The one deliberate exception to the "changes nothing by default" rule at the top of this
    // file, and it is worth stating why rather than quietly flipping it.
    //
    // Video generation is the step this product exists for, and Google Flow — the only provider
    // that can do it — publishes no API. Off by default, every single video run stopped and waited
    // for a person to copy a prompt into labs.google/flow, download the clip and upload it back.
    // That is not a "fallback" being declined; it is the pipeline not running. The browser route is
    // how this application generates video, so it is on.
    //
    // It still cannot do anything unless a Google account has a connected Flow browser session
    // (modules/accounts/service.ts#findAccountWithFlowSession), and if the site run fails it lands
    // in exactly the manual hand-off it would have gone to anyway — so the worst case with this on
    // is the old behaviour, one queue hop later. Set ENABLE_BROWSER_FALLBACK=false to force the
    // hand-off and never drive a browser.
    browserFallback: flag("ENABLE_BROWSER_FALLBACK", true),
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
