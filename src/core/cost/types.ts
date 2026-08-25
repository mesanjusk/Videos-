/**
 * Cost policy — the mechanism that makes "this run must not spend money" enforceable rather than
 * a matter of remembering which provider is which.
 *
 * The governing rule, and the reason this exists at all: **the system must never silently spend
 * money.** Everything below follows from that, including the one design decision that will
 * occasionally be inconvenient — a provider whose cost cannot be verified is treated as paid, not
 * as free. "We don't know" and "it's free" are different answers, and only one of them is safe to
 * act on.
 */

export const COST_POLICIES = ["ZERO_COST", "FREE_PREFERRED", "BALANCED", "BEST_QUALITY"] as const;
export type CostPolicy = (typeof COST_POLICIES)[number];

export const DEFAULT_COST_POLICY: CostPolicy = "BALANCED";

/**
 * - `free`   — no metered charge, verifiably. A local model, local disk, a self-hosted service.
 * - `paid`   — metered, or on a quota that costs money past a threshold.
 * - `unknown`— pricing not established in this codebase. Treated as `paid` everywhere it matters.
 */
export type CostClass = "free" | "paid" | "unknown";

export interface QuotaSnapshot {
  /** Remaining units, or "unknown" when the provider exposes no quota information. */
  remaining: number | "unknown";
  /** Unit the number is counted in, for display ("requests", "characters", "seconds"). */
  unit?: string;
  resetsAt?: Date;
}

export interface ProviderCostPolicy {
  readonly costClass: CostClass;
  /** Human-readable basis for the classification — shown in the provider matrix. */
  readonly rationale: string;

  isFree(): boolean;
  requiresPayment(): boolean;
  /** Estimated USD for one unit of work, or "unknown" when it cannot be established. */
  estimatedCost(units?: number): number | "unknown";
  quotaRemaining(): Promise<QuotaSnapshot>;
  /**
   * The single question ZERO_COST asks. Must return false whenever `costClass` is `unknown` —
   * that is not a judgement call, it is the safety property this whole module exists to hold.
   */
  canRunInZeroCostMode(): boolean;
}

export interface FreeCostPolicyInput {
  rationale: string;
  quota?: () => Promise<QuotaSnapshot>;
}

/** A provider that costs nothing to run — a local binary, a self-hosted service, the filesystem. */
export function freeCostPolicy(input: FreeCostPolicyInput): ProviderCostPolicy {
  return {
    costClass: "free",
    rationale: input.rationale,
    isFree: () => true,
    requiresPayment: () => false,
    estimatedCost: () => 0,
    quotaRemaining: input.quota ?? (async () => ({ remaining: "unknown" as const })),
    canRunInZeroCostMode: () => true,
  };
}

export interface PaidCostPolicyInput {
  rationale: string;
  /** USD per unit, when known. Omit when the provider's pricing is not established here. */
  usdPerUnit?: number;
  quota?: () => Promise<QuotaSnapshot>;
}

/** A metered provider. Never runnable under ZERO_COST, whether or not a free tier exists. */
export function paidCostPolicy(input: PaidCostPolicyInput): ProviderCostPolicy {
  return {
    costClass: "paid",
    rationale: input.rationale,
    isFree: () => false,
    requiresPayment: () => true,
    estimatedCost: (units = 1) => (input.usdPerUnit === undefined ? "unknown" : input.usdPerUnit * units),
    quotaRemaining: input.quota ?? (async () => ({ remaining: "unknown" as const })),
    canRunInZeroCostMode: () => false,
  };
}

/**
 * Pricing not established. Deliberately behaves exactly like paid at every decision point.
 *
 * This is the default for a provider that does not declare a policy, which means the failure mode
 * of forgetting to classify a new provider is "it won't run in ZERO_COST", not "it silently
 * charged someone".
 */
export function unknownCostPolicy(rationale = "Pricing for this provider has not been verified."): ProviderCostPolicy {
  return {
    costClass: "unknown",
    rationale,
    isFree: () => false,
    requiresPayment: () => true,
    estimatedCost: () => "unknown",
    quotaRemaining: async () => ({ remaining: "unknown" as const }),
    canRunInZeroCostMode: () => false,
  };
}

/**
 * A free tier on a metered service — e.g. an API key with N free calls a day, billed after that.
 *
 * Classified **paid**, not free, and the rationale says why: a free allowance that silently becomes
 * a charge on the N+1th call is exactly the thing ZERO_COST exists to prevent. Such a provider is
 * still preferred under FREE_PREFERRED while its quota holds, which is the policy that wants it.
 */
export function meteredFreeTierCostPolicy(input: PaidCostPolicyInput): ProviderCostPolicy {
  return {
    ...paidCostPolicy(input),
    costClass: "paid",
    rationale: `${input.rationale} (Free allowance, then metered — not ZERO_COST-safe: exceeding the allowance bills silently.)`,
  };
}
