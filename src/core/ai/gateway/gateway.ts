import {
  resolveCostPolicy,
  rankProviders,
  checkProviderAllowed,
  NoPermittedProviderError,
  type CostPolicy,
} from "@/core/cost";
import {
  PROVIDER_METADATA,
  isProviderConfigured,
  describeUnavailability,
  type ProviderRuntimeDescriptor,
  type SuppliedRequirements,
} from "@/core/ai/provider-metadata";
import { ProviderQuotaExceededError } from "@/core/ai/types";

/**
 * The routing layer between business logic and any concrete AI provider.
 *
 * Callers ask for a *capability* — "generate an image" — and never name a vendor. The gateway
 * decides which provider serves it, using the run's cost policy, what is actually configured, and
 * a declared fallback order. This is the mechanism behind the rule that business logic must not
 * hard-code Gemini, Ideogram or anything else.
 *
 * ## Routing order
 *
 * Within whatever the cost policy permits, a local execution path is preferred over a cloud API.
 * Not for cost reasons — the policy has already had its say — but because a local service is the
 * one that still works with no network, no key and no quota, which is what "local-first" means
 * here in practice.
 *
 * ## Fallback
 *
 * A provider that fails is retried through the next in its declared `fallbacks` chain, and each
 * candidate is re-checked against the cost policy before it is used. **The chain never escalates
 * cost.** Under ZERO_COST a failing free provider falls back only to another free provider, and if
 * there is none the run fails with an explanation. Falling back from a free provider to a paid one
 * would turn a policy the caller selected specifically to avoid spending into the thing that spends.
 */

export interface GatewayResolution {
  descriptor: ProviderRuntimeDescriptor;
  policy: CostPolicy;
  /** The remaining candidates, in order, if this one fails. */
  fallbacks: ProviderRuntimeDescriptor[];
}

export interface ResolveOptions {
  /** Overrides the deployment default. Comes from a production profile or an explicit request. */
  costPolicy?: string | null;
  /** Try this provider first if the policy permits it and it is configured. */
  preferredProviderId?: string | null;
  /**
   * Requirement keys the caller already holds a credential for, so they need not be in the
   * environment — a resolved pooled Google account supplies `GEMINI_API_KEY`, for instance. Without
   * this, a deployment that keeps its Gemini keys on connected accounts (which is the intended
   * shape — see providers/google/gemini-client.ts) has no configured text provider at all.
   */
  suppliedRequirements?: SuppliedRequirements;
}

export interface ExecutionOutcome<T> {
  result: T;
  providerId: string;
  /** Providers that were tried and failed before this one succeeded. */
  attempted: { providerId: string; error: string }[];
  policy: CostPolicy;
}

const EXECUTION_PREFERENCE: Record<ProviderRuntimeDescriptor["execution"], number> = {
  "local-process": 0,
  "local-service": 1,
  "cloud-api": 2,
  "browser-automation": 3,
  manual: 4,
};

export class AiGateway {
  constructor(private readonly catalogue: ProviderRuntimeDescriptor[] = PROVIDER_METADATA) {}

  /** Every candidate for a capability, with availability resolved. Used by System Health too. */
  candidates(capability: string, supplied: SuppliedRequirements = []) {
    return this.catalogue
      .filter((descriptor) => descriptor.capability === capability)
      .map((descriptor) => ({
        id: descriptor.id,
        cost: descriptor.cost,
        available: isProviderConfigured(descriptor, supplied),
        unavailableReason: describeUnavailability(descriptor, supplied),
        descriptor,
      }));
  }

  /**
   * Picks the provider for one capability, or explains why none can serve it.
   *
   * Throws `NoPermittedProviderError` rather than returning null: "nothing is available" is not a
   * condition a caller should be able to ignore by accident, and the error carries what was
   * considered and why each was rejected, which is what an operator needs to fix it.
   */
  resolve(capability: string, options: ResolveOptions = {}): GatewayResolution {
    const policy = resolveCostPolicy(options.costPolicy);
    const supplied = options.suppliedRequirements ?? [];
    const ranked = rankProviders(policy, this.candidates(capability, supplied));

    const ordered = [...ranked].sort(
      (a, b) => EXECUTION_PREFERENCE[a.descriptor.execution] - EXECUTION_PREFERENCE[b.descriptor.execution],
    );

    if (options.preferredProviderId) {
      const preferred = ordered.findIndex((c) => c.id === options.preferredProviderId);
      if (preferred > 0) ordered.unshift(...ordered.splice(preferred, 1));
    }

    const chosen = ordered[0];
    if (!chosen) {
      throw new NoPermittedProviderError(
        policy,
        capability,
        this.candidates(capability, supplied).map((c) => ({ id: c.id, reason: checkProviderAllowed(policy, c).reason })),
      );
    }

    return {
      descriptor: chosen.descriptor,
      policy,
      fallbacks: ordered.slice(1).map((c) => c.descriptor),
    };
  }

  /**
   * Runs `work` against the resolved provider, falling back down the chain on failure.
   *
   * Each fallback is re-checked against the cost policy immediately before use — the ranking
   * already filtered, but re-checking means a change in configuration between resolution and
   * fallback cannot slip a forbidden provider through.
   */
  async execute<T>(
    capability: string,
    options: ResolveOptions,
    work: (descriptor: ProviderRuntimeDescriptor) => Promise<T>,
  ): Promise<ExecutionOutcome<T>> {
    const resolution = this.resolve(capability, options);
    const supplied = options.suppliedRequirements ?? [];
    const chain = [resolution.descriptor, ...resolution.fallbacks];
    const attempted: { providerId: string; error: string }[] = [];
    const failures: unknown[] = [];

    for (const descriptor of chain) {
      const decision = checkProviderAllowed(resolution.policy, {
        id: descriptor.id,
        cost: descriptor.cost,
        available: isProviderConfigured(descriptor, supplied),
        unavailableReason: describeUnavailability(descriptor, supplied),
      });
      if (!decision.allowed) {
        attempted.push({ providerId: descriptor.id, error: `skipped: ${decision.reason}` });
        continue;
      }

      try {
        const result = await work(descriptor);
        return { result, providerId: descriptor.id, attempted, policy: resolution.policy };
      } catch (err) {
        failures.push(err);
        attempted.push({ providerId: descriptor.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // A quota failure survives the aggregation. The queue's account rotation keys off the *type*
    // of this error (processors/helpers.ts marks the pooled account exhausted and lets BullMQ
    // retry against another one), and flattening it into a plain Error would silently disable that
    // for every caller routed through the gateway.
    const quota = failures.find((err): err is ProviderQuotaExceededError => err instanceof ProviderQuotaExceededError);
    if (quota) throw quota;

    throw new Error(
      `Every provider for "${capability}" failed under cost policy ${resolution.policy}: ` +
        attempted.map((a) => `${a.providerId} (${a.error})`).join("; "),
    );
  }
}

/** The process-wide gateway. Tests construct their own with a fixture catalogue. */
export const aiGateway = new AiGateway();
