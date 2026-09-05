import type { Page } from "playwright";
import type { TaskStep } from "./types";
import type { BrowserAutomationEventBus } from "./event-bus";
import type { ActionEngine } from "./action-engine";
import type { ProviderAdapter } from "./provider-adapter";
import type { RecoveryEngine, RecoveryContext, RecoveryAction, RecoveryTrigger } from "./recovery-engine";
import { waitForStability } from "./page-probe";

export interface ActionPipelineResult {
  step: TaskStep;
  success: boolean;
  error?: string;
  attempts: number;
  /** Whatever `provider.executeAction()` returned for this step — see the doc comment on
   * `ProviderAdapter.executeAction` for why this exists (Module 7B). */
  output?: Record<string, unknown>;
  /** What visibly changed on the page as a result — see `MUTATING_ACTIONS` below. */
  changeSummary?: string;
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

/**
 * Actions that are supposed to move the page, and so are worth waiting to settle before the next
 * step reads it.
 *
 * Without this the pipeline fires steps at whatever the DOM happens to be mid-render: click
 * Generate, then immediately look for the prompt box on a page still tearing down the previous
 * screen. Settling first is why the following step sees a finished page, and the change summary it
 * produces is what turns "the click succeeded" into "the click succeeded *and something happened*".
 *
 * Excluded on purpose: `navigate` (Playwright's own load wait already covers it), `wait`,
 * `sleep`, `wait_for_state` and the read-only captures — all of which either wait by definition or
 * must not perturb the page.
 */
const MUTATING_ACTIONS = new Set<TaskStep["action"]>([
  "click", "double_click", "right_click", "input_text", "paste", "keyboard_shortcut", "upload_file", "drag",
]);

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
  // A selector is now either a bare CSS string (as before) or a SelectorTarget object giving the
  // resolver several ways to find the same element — see action-engine.ts. Both are accepted;
  // an empty object is not, since it would resolve to nothing and fail confusingly later.
  if (needsSelector.includes(step.action)) {
    const selector = step.params.selector;
    const usable =
      (typeof selector === "string" && selector.length > 0) ||
      (typeof selector === "object" && selector !== null && Object.values(selector).some((v) => v !== undefined));
    if (!usable) {
      return { valid: false, reason: `Step ${step.id} (${step.action}) is missing a usable "selector" param` };
    }
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
        const output = (await provider.executeAction(currentPage, step, actionEngine)) ?? undefined;

        let changeSummary: string | undefined;
        if (MUTATING_ACTIONS.has(step.action)) {
          const stability = await waitForStability(currentPage).catch(() => null);
          changeSummary = stability?.summary;
          // Only a step that asked for it fails on "nothing happened". Plenty of real actions
          // legitimately change nothing measurable — typing into an already-focused box, clicking a
          // toggle that was already in the wanted state — and failing those would trade one class
          // of silent wrongness for a noisier one.
          if (step.expectChange && stability && !stability.changed) {
            throw new Error(
              `Step ${step.id} (${step.action}) had no visible effect on the page — ` +
                "the selector probably resolved to the wrong element or a disabled control",
            );
          }
        }

        const verified = step.verify ? await provider.verifyResult(currentPage, step) : true;
        if (!verified) throw new Error(`Verification failed for step ${step.id}`);

        eventBus.emit({
          runId,
          event: "ActionCompleted",
          timestamp: new Date(),
          data: { stepId: step.id, ...(changeSummary ? { changeSummary } : {}) },
        });
        return { step, success: true, attempts: attempt, output, changeSummary };
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
