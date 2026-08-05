import type { Page } from "playwright";
import type { TaskStep } from "./types";
import type { BrowserAutomationEventBus } from "./event-bus";
import type { ActionEngine } from "./action-engine";
import type { ProviderAdapter } from "./provider-adapter";
import type { RecoveryEngine, RecoveryContext, RecoveryAction, RecoveryTrigger } from "./recovery-engine";

export interface ActionPipelineResult {
  step: TaskStep;
  success: boolean;
  error?: string;
  attempts: number;
}

/** Validate -> Execute -> Verify -> Success | Failure -> Recovery -> Retry, per TaskStep. */
export interface ActionPipeline {
  run(page: Page, step: TaskStep): Promise<ActionPipelineResult>;
}

export interface ActionPipelineDependencies {
  runId: string;
  eventBus: BrowserAutomationEventBus;
  actionEngine: ActionEngine;
  provider: ProviderAdapter;
  recoveryEngine: RecoveryEngine;
  /**
   * Carries out a RecoveryEngine decision that needs browser/tab-level access the pipeline itself
   * doesn't own (e.g. restarting the browser) — supplied by the TaskEngine, which does own the
   * BrowserManager/TabManager for this run. Returns the Page to continue the retry on.
   */
  applyRecovery: (action: RecoveryAction, context: RecoveryContext) => Promise<Page>;
}

/** A hard ceiling independent of RecoveryEngine's own bookkeeping, in case a custom RecoveryEngine
 * implementation never returns "abort". */
const HARD_ATTEMPT_CEILING = 10;

function classifyTrigger(error: unknown): RecoveryTrigger {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("crash")) return "page_crash";
  if (message.includes("closed") || message.includes("disconnected")) return "lost_connection";
  if (message.includes("navigation")) return "unexpected_navigation";
  if (message.includes("popup") || message.includes("dialog")) return "popup";
  return "timeout";
}

function validateStep(step: TaskStep): { valid: boolean; reason?: string } {
  const needsSelector: TaskStep["action"][] = [
    "click", "double_click", "right_click", "hover", "input_text", "paste", "upload_file", "wait",
  ];
  if (needsSelector.includes(step.action) && typeof step.params.selector !== "string") {
    return { valid: false, reason: `Step ${step.id} (${step.action}) is missing a "selector" param` };
  }
  return { valid: true };
}

export class DefaultActionPipeline implements ActionPipeline {
  constructor(private readonly deps: ActionPipelineDependencies) {}

  async run(page: Page, step: TaskStep): Promise<ActionPipelineResult> {
    const { runId, eventBus, actionEngine, provider, recoveryEngine, applyRecovery } = this.deps;
    let currentPage = page;
    let attempt = 0;

    while (attempt < HARD_ATTEMPT_CEILING) {
      attempt += 1;
      const validation = validateStep(step);
      if (!validation.valid) {
        return { step, success: false, error: validation.reason, attempts: attempt };
      }

      eventBus.emit({ runId, event: "ActionStarted", timestamp: new Date(), data: { stepId: step.id, action: step.action } });

      try {
        await provider.executeAction(currentPage, step, actionEngine);
        const verified = step.verify ? await provider.verifyResult(currentPage, step) : true;
        if (!verified) throw new Error(`Verification failed for step ${step.id}`);

        eventBus.emit({ runId, event: "ActionCompleted", timestamp: new Date(), data: { stepId: step.id } });
        return { step, success: true, attempts: attempt };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        eventBus.emit({ runId, event: "ActionFailed", timestamp: new Date(), data: { stepId: step.id, error: errorMessage } });

        const context: RecoveryContext = { runId, trigger: classifyTrigger(err), step, attempt };
        const decision = await recoveryEngine.recover(context);

        if (decision.type === "abort") {
          return { step, success: false, error: errorMessage, attempts: attempt };
        }

        eventBus.emit({ runId, event: "RetryStarted", timestamp: new Date(), data: { stepId: step.id, recovery: decision.type } });
        if (decision.type === "retry_action") continue;
        currentPage = await applyRecovery(decision, context);
      }
    }

    return { step, success: false, error: "Exceeded hard attempt ceiling", attempts: HARD_ATTEMPT_CEILING };
  }
}
