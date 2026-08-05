import type { Page } from "playwright";
import type { BrowserTask, TaskStep } from "./types";
import type { ActionEngine } from "./action-engine";
import type { RecoveryContext, RecoveryAction } from "./recovery-engine";

/**
 * The plugin contract every future provider (Google Flow, Veo, Runway, Kling, Pika, ...)
 * implements. Never hardcode provider logic in the framework — everything provider-specific
 * (selectors, prompts, upload flows) lives behind this interface, in a separate module.
 */
export interface ProviderAdapter {
  readonly id: string;
  readonly label: string;
  initialize(context: { page: Page; task: BrowserTask }): Promise<void>;
  validate(task: BrowserTask): Promise<{ valid: boolean; reason?: string }>;
  executeAction(page: Page, step: TaskStep, engine: ActionEngine): Promise<void>;
  verifyResult(page: Page, step: TaskStep): Promise<boolean>;
  recover(context: RecoveryContext): Promise<RecoveryAction>;
  shutdown(): Promise<void>;
}

export interface ProviderRegistry {
  register(adapter: ProviderAdapter): void;
  get(providerId: string): ProviderAdapter | undefined;
  list(): ProviderAdapter[];
}

/** Empty until a future module (7B or later) registers a real adapter — deliberately. */
export class InMemoryProviderRegistry implements ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  get(providerId: string): ProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }

  list(): ProviderAdapter[] {
    return [...this.adapters.values()];
  }
}
