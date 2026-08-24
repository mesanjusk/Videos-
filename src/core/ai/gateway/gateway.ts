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
  type ProviderRuntimeDescriptor,
} from "@/core/ai/provider-metadata";

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
  candidates(capability: string) {
    return this.catalogue
      .filter((descriptor) => descriptor.capability === capability)
      .map((descriptor) => ({
        id: descriptor.id,
        cost: descriptor.cost,
        available: isProviderConfigured(descriptor),
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
    const ranked = rankProviders(policy, this.candidates(capability));

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
        this.candidates(capability).map((c) => ({ id: c.id, reason: checkProviderAllowed(policy, c).reason })),
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
    const chain = [resolution.descriptor, ...resolution.fallbacks];
    const attempted: { providerId: string; error: string }[] = [];

    for (const descriptor of chain) {
      const decision = checkProviderAllowed(resolution.policy, {
        id: descriptor.id,
        cost: descriptor.cost,
        available: isProviderConfigured(descriptor),
      });
      if (!decision.allowed) {
        attempted.push({ providerId: descriptor.id, error: `skipped: ${decision.reason}` });
        continue;
      }

      try {
        const result = await work(descriptor);
        return { result, providerId: descriptor.id, attempted, policy: resolution.policy };
      } catch (err) {
        attempted.push({ providerId: descriptor.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    throw new Error(
      `Every provider for "${capability}" failed under cost policy ${resolution.policy}: ` +
        attempted.map((a) => `${a.providerId} (${a.error})`).join("; "),
    );
  }
}

/** The process-wide gateway. Tests construct their own with a fixture catalogue. */
export const aiGateway = new AiGateway();
