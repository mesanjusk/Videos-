import { getFeatureFlags } from "@/core/config/flags";
import { COST_POLICIES, DEFAULT_COST_POLICY, type CostPolicy, type ProviderCostPolicy } from "./types";

/**
 * Raised when a run under a cost policy would have used a provider that policy forbids.
 *
 * Deliberately a hard failure and never a fallback. Under ZERO_COST the correct outcome of "no
 * free route exists" is to say so, not to quietly reach for a paid one — a fallback that costs
 * money is the exact behaviour the policy was selected to prevent.
 */
export class CostPolicyViolationError extends Error {
  constructor(
    readonly policy: CostPolicy,
    readonly providerId: string,
    readonly reason: string,
  ) {
    super(`Cost policy ${policy} refuses provider "${providerId}": ${reason}`);
    this.name = "CostPolicyViolationError";
  }
}

/** Raised when a capability has no provider the active policy permits. */
export class NoPermittedProviderError extends Error {
  constructor(
    readonly policy: CostPolicy,
    readonly capability: string,
    readonly considered: { id: string; reason: string }[],
  ) {
    super(
      `No provider for "${capability}" is available under cost policy ${policy}. ` +
        `Considered: ${considered.map((c) => `${c.id} (${c.reason})`).join(", ") || "none"}.`,
    );
    this.name = "NoPermittedProviderError";
  }
}

export interface CostPolicyCandidate {
  id: string;
  cost: ProviderCostPolicy;
  /** Whether the provider is configured and reachable at all. */
  available: boolean;
}

export interface PermissionDecision {
  allowed: boolean;
  reason: string;
}

function isZeroCostAllowed(): boolean {
  return getFeatureFlags().zeroCostMode;
}

/** Reads the deployment-wide default. A production profile or an explicit request overrides it. */
export function resolveCostPolicy(requested?: string | null): CostPolicy {
  const candidate = (requested ?? process.env.DEFAULT_COST_POLICY ?? DEFAULT_COST_POLICY) as CostPolicy;
  if (!COST_POLICIES.includes(candidate)) return DEFAULT_COST_POLICY;
  if (candidate === "ZERO_COST" && !isZeroCostAllowed()) {
    // The operator has explicitly forbidden the policy. Refusing to honour a request for it is
    // right; silently downgrading to BALANCED and then spending money would not be, so this
    // throws rather than degrading.
    throw new Error("ZERO_COST was requested but ENABLE_ZERO_COST_MODE is off for this deployment.");
  }
  return candidate;
}

/**
 * The single gate every provider selection passes through.
 *
 * There is exactly one rule for ZERO_COST and it has no exceptions: the provider must classify
 * itself free *and* answer yes to `canRunInZeroCostMode()`. An unverified provider answers no by
 * construction (see `unknownCostPolicy`), so forgetting to classify something means it cannot run
 * under ZERO_COST — never that it runs and bills.
 */
export function checkProviderAllowed(policy: CostPolicy, candidate: CostPolicyCandidate): PermissionDecision {
  if (!candidate.available) {
    return { allowed: false, reason: "not configured or unreachable" };
  }

  if (policy === "ZERO_COST") {
    if (candidate.cost.costClass === "unknown") {
      return { allowed: false, reason: "cost is unverified, and unverified counts as paid under ZERO_COST" };
    }
    if (!candidate.cost.isFree() || !candidate.cost.canRunInZeroCostMode()) {
      return { allowed: false, reason: candidate.cost.rationale };
    }
    return { allowed: true, reason: "free and ZERO_COST-safe" };
  }

  return { allowed: true, reason: "permitted by policy" };
}

/**
 * Orders the permitted candidates for a capability, best first for the given policy.
 *
 * - ZERO_COST     — free only; anything else is filtered out entirely.
 * - FREE_PREFERRED— free first, then paid. Nothing is forbidden.
 * - BALANCED      — registry order, i.e. whatever the operator configured as preferred.
 * - BEST_QUALITY  — reversed cost order: the paid provider first, on the assumption that if you
 *                   are paying you want the thing you are paying for.
 */
export function rankProviders<T extends CostPolicyCandidate>(policy: CostPolicy, candidates: T[]): T[] {
  const permitted = candidates.filter((c) => checkProviderAllowed(policy, c).allowed);

  if (policy === "FREE_PREFERRED") {
    return [...permitted].sort((a, b) => Number(b.cost.isFree()) - Number(a.cost.isFree()));
  }
  if (policy === "BEST_QUALITY") {
    return [...permitted].sort((a, b) => Number(a.cost.isFree()) - Number(b.cost.isFree()));
  }
  return permitted;
}

/** Throws rather than returning a violation — for the call sites where proceeding is not an option. */
export function assertProviderAllowed(policy: CostPolicy, candidate: CostPolicyCandidate): void {
  const decision = checkProviderAllowed(policy, candidate);
  if (!decision.allowed) throw new CostPolicyViolationError(policy, candidate.id, decision.reason);
}

/** Picks the single provider to use, or explains precisely why none can be. */
export function selectProvider<T extends CostPolicyCandidate>(
  policy: CostPolicy,
  capability: string,
  candidates: T[],
): T {
  const ranked = rankProviders(policy, candidates);
  const chosen = ranked[0];
  if (!chosen) {
    throw new NoPermittedProviderError(
      policy,
      capability,
      candidates.map((c) => ({ id: c.id, reason: checkProviderAllowed(policy, c).reason })),
    );
  }
  return chosen;
}
