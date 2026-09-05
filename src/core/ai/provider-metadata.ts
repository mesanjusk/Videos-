import type { AiCapability } from "./types";
import { getFeatureFlags, FLAG_ENV_VARS } from "@/core/config/flags";
import {
  freeCostPolicy,
  meteredFreeTierCostPolicy,
  paidCostPolicy,
  unknownCostPolicy,
  type ProviderCostPolicy,
} from "@/core/cost";

/**
 * Capability, cost, requirements and health for every AI provider — the metadata layer neither
 * source project had.
 *
 * Kept **beside** `registry.ts` rather than folded into the provider classes, deliberately. The
 * provider classes are about how to call a service; this is about whether a run is allowed to,
 * which is a policy question the caller owns. Separating them means adding cost information to an
 * existing provider does not touch the code that makes the request.
 *
 * ## On cost classification
 *
 * Each entry's `rationale` states the basis for its classification. Where this codebase cannot
 * verify pricing — which is most third-party APIs, since pricing changes and nothing here can
 * check it at runtime — the provider is classified `unknown`, which behaves as paid everywhere.
 * That is the safe direction: the cost of over-classifying is that a ZERO_COST run refuses to
 * start; the cost of under-classifying is a surprise invoice.
 *
 * Nothing here claims a provider is free because a gateway or a free tier fronts it. A free
 * allowance on a metered account still bills on the call after the allowance runs out, so it is
 * `meteredFreeTierCostPolicy` — preferred under FREE_PREFERRED, refused under ZERO_COST.
 */

export type HealthStatus = "up" | "down" | "unknown";

export interface ProviderRuntimeDescriptor {
  id: string;
  label: string;
  capability: AiCapability | "render" | "storage" | "browser";
  /** Where the work runs. Drives the provider matrix and the local-first routing preference. */
  execution: "cloud-api" | "local-service" | "local-process" | "browser-automation" | "manual";
  cost: ProviderCostPolicy;
  /** Env vars that must be set for this provider to be usable. Empty means no configuration needed. */
  requirements: string[];
  /** Feature flag that must be on, if any. */
  flag?: keyof ReturnType<typeof getFeatureFlags>;
  rateLimit?: { perMinute?: number; perDay?: number };
  /** Ordered provider ids to try if this one fails. Never crosses from free to paid on its own —
   *  the gateway re-checks the cost policy for each fallback before using it. */
  fallbacks?: string[];
  /** What an operator should actually do to make this provider usable, when env vars alone don't
   *  tell the whole story (Gemini's real credential is a connected account, not a key in the env). */
  configurationHint?: string;
  notes?: string;
}

/**
 * Requirement keys a caller has already satisfied at runtime, so they don't have to be in the
 * environment.
 *
 * The case this exists for: Gemini's credential in a real deployment is the encrypted API key on a
 * connected Google account (modules/accounts), and `GEMINI_API_KEY` is only the local-dev fallback
 * — see providers/google/gemini-client.ts. A caller that has resolved a pooled account holds a
 * usable Gemini credential, and without a way to say so the gateway would rule Gemini out on an
 * env var that deployment deliberately doesn't set.
 */
export type SuppliedRequirements = readonly string[];

/** The requirement key a resolved Google account credential stands in for. */
export const GEMINI_REQUIREMENT = "GEMINI_API_KEY";

function isRequirementSatisfied(key: string, supplied: SuppliedRequirements): boolean {
  return Boolean(process.env[key]) || supplied.includes(key);
}

export function isProviderConfigured(
  descriptor: ProviderRuntimeDescriptor,
  supplied: SuppliedRequirements = [],
): boolean {
  if (descriptor.flag && !getFeatureFlags()[descriptor.flag]) return false;
  return descriptor.requirements.every((key) => isRequirementSatisfied(key, supplied));
}

export function missingRequirements(
  descriptor: ProviderRuntimeDescriptor,
  supplied: SuppliedRequirements = [],
): string[] {
  return descriptor.requirements.filter((key) => !isRequirementSatisfied(key, supplied));
}

/**
 * Why this provider cannot serve a call, phrased as what to change.
 *
 * "not configured or unreachable" is true and useless: it names nothing an operator can act on.
 * This is what ends up in `NoPermittedProviderError`, which is the message a failed job shows, so
 * it names the flag and the variables instead.
 */
export function describeUnavailability(
  descriptor: ProviderRuntimeDescriptor,
  supplied: SuppliedRequirements = [],
): string {
  const steps: string[] = [];
  if (descriptor.flag && !getFeatureFlags()[descriptor.flag]) {
    steps.push(`set ${FLAG_ENV_VARS[descriptor.flag]}=true`);
  }

  const missing = missingRequirements(descriptor, supplied);
  if (missing.length) {
    steps.push(descriptor.configurationHint ?? `set ${missing.join(" and ")}`);
  }

  return steps.length ? steps.join(", then ") : "not configured or unreachable";
}

const GEMINI_KEYS = [GEMINI_REQUIREMENT];

/** Gemini's credential is a connected account first; the env key is the local-dev fallback. */
const GEMINI_HINT = "connect a Google account in Account Manager, or set GEMINI_API_KEY";

export const PROVIDER_METADATA: ProviderRuntimeDescriptor[] = [
  // ── Gemini ────────────────────────────────────────────────────────────────────────────────
  // Google's API has a free tier on most models and bills past it. That is precisely the shape
  // ZERO_COST must refuse: nothing in a running job can tell which side of the allowance it is on.
  {
    id: "gemini",
    label: "Google Gemini (text)",
    capability: "story",
    execution: "cloud-api",
    cost: meteredFreeTierCostPolicy({ rationale: "Google AI Studio API key; free allowance then metered." }),
    requirements: GEMINI_KEYS,
    configurationHint: GEMINI_HINT,
    fallbacks: ["omniroute", "local-llm"],
  },
  {
    id: "gemini",
    label: "Google Gemini (image)",
    capability: "image",
    execution: "cloud-api",
    cost: meteredFreeTierCostPolicy({ rationale: "Google AI Studio API key; free allowance then metered." }),
    requirements: GEMINI_KEYS,
    configurationHint: GEMINI_HINT,
    fallbacks: ["local-image", "ideogram"],
  },
  {
    id: "gemini",
    label: "Google Gemini (TTS)",
    capability: "voice",
    execution: "cloud-api",
    cost: meteredFreeTierCostPolicy({ rationale: "Google AI Studio API key; free allowance then metered." }),
    requirements: GEMINI_KEYS,
    configurationHint: GEMINI_HINT,
    fallbacks: ["voicebox"],
  },

  // ── Google Flow ───────────────────────────────────────────────────────────────────────────
  // No public API. The manual provider hands a prompt to a person; the browser-automation path
  // drives the site with a signed-in session. Neither is metered by this application, but neither
  // is "free" in a sense ZERO_COST can rely on either — the account behind it may well be paid,
  // and this codebase has no way to check. Classified unknown, which is the honest answer.
  {
    id: "google-flow",
    label: "Google Flow (manual hand-off)",
    capability: "video",
    execution: "manual",
    cost: unknownCostPolicy("Requires a Google account whose plan and quota this application cannot inspect."),
    requirements: [],
    notes: "Returns a prompt for a human to run. Always available; costs nothing here, but the account may be paid.",
  },
  {
    id: "google-flow-browser",
    label: "Google Flow (browser automation)",
    capability: "video",
    execution: "browser-automation",
    cost: unknownCostPolicy("Drives a signed-in Google account whose plan and quota this application cannot inspect."),
    requirements: [],
    flag: "browserFallback",
    notes: "Needs a connected Flow browser session and Chromium on the worker host.",
  },

  // ── Ideogram ──────────────────────────────────────────────────────────────────────────────
  {
    id: "ideogram",
    label: "Ideogram (typography-first images)",
    capability: "image",
    execution: "cloud-api",
    cost: paidCostPolicy({ rationale: "Metered API; no free tier this application can rely on." }),
    requirements: ["IDEOGRAM_API_KEY"],
    flag: "ideogram",
    notes: "Strong on text-in-image: title cards, posters, thumbnails, invitations.",
  },

  // ── Voicebox ──────────────────────────────────────────────────────────────────────────────
  {
    id: "voicebox",
    label: "Voicebox (self-hosted TTS)",
    capability: "voice",
    execution: "local-service",
    cost: freeCostPolicy({ rationale: "Self-hosted service; no metered charge." }),
    requirements: ["VOICEBOX_URL"],
    flag: "voicebox",
    notes: "Runs wherever you host it. Free in the sense that matters here: no per-call billing.",
  },

  // ── Local model workers ───────────────────────────────────────────────────────────────────
  {
    id: "local-image",
    label: "Local image worker",
    capability: "image",
    execution: "local-service",
    cost: freeCostPolicy({ rationale: "Runs on hardware you already pay for; no per-image charge." }),
    requirements: ["LOCAL_AI_IMAGE_URL"],
    flag: "localAi",
    notes: "Any HTTP service speaking the shape in core/ai/providers/local — Easy Diffusion, A1111, ComfyUI behind a small adapter.",
  },
  {
    id: "local-llm",
    label: "Local LLM",
    capability: "story",
    execution: "local-service",
    cost: freeCostPolicy({ rationale: "Self-hosted OpenAI-compatible endpoint; no per-token charge." }),
    requirements: ["LOCAL_AI_LLM_URL"],
    flag: "localAi",
  },

  // ── OmniRoute ─────────────────────────────────────────────────────────────────────────────
  // A gateway is not a pricing model. What it costs depends entirely on which upstream it routes
  // to, which this application cannot see — so it is unknown, and therefore not ZERO_COST-safe.
  // Claiming otherwise would be the single easiest way to make this whole module a lie.
  {
    id: "omniroute",
    label: "OmniRoute gateway",
    capability: "story",
    execution: "cloud-api",
    cost: unknownCostPolicy("A gateway's cost is whatever upstream it selects; this application cannot verify it."),
    requirements: ["OMNIROUTE_BASE_URL"],
    flag: "omniRoute",
    notes: "Routes to whichever model it is configured for. Set OMNIROUTE_ZERO_COST_MODELS to allow specific verified-free models under ZERO_COST.",
  },

  // ── Rendering ─────────────────────────────────────────────────────────────────────────────
  {
    id: "ffmpeg",
    label: "FFmpeg",
    capability: "render",
    execution: "local-process",
    cost: freeCostPolicy({ rationale: "Bundled binary (ffmpeg-static); runs locally at no charge." }),
    requirements: [],
    notes: "The default and the fallback. Never replaced — see docs/RENDERING.md.",
  },
  {
    id: "hyperframes",
    label: "HyperFrames (HTML/CSS composition)",
    capability: "render",
    execution: "local-process",
    cost: freeCostPolicy({ rationale: "Renders locally in a headless browser; no metered charge." }),
    requirements: [],
    flag: "hyperframes",
    notes: "Motion graphics, captions, lower thirds. Muxing and final encode stay with FFmpeg.",
  },
];

export function findProviderMetadata(capability: string, id: string): ProviderRuntimeDescriptor | undefined {
  return PROVIDER_METADATA.find((p) => p.capability === capability && p.id === id);
}

export function listProviderMetadata(capability?: string): ProviderRuntimeDescriptor[] {
  return capability ? PROVIDER_METADATA.filter((p) => p.capability === capability) : PROVIDER_METADATA;
}
