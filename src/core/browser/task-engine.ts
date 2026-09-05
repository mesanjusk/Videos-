import type { BrowserContext, Page } from "playwright";
import type { BrowserTask, TaskResult, ExecutionState } from "./types";
import type { BrowserAutomationEventBus } from "./event-bus";
import type { BrowserManager } from "./browser-manager";
import type { TabManager } from "./tab-manager";
import type { SessionManager } from "./session-manager";
import type { StateEngine } from "./state-engine";
import type { RecoveryEngine, RecoveryAction, RecoveryContext } from "./recovery-engine";
import type { ActionEngine } from "./action-engine";
import type { ProviderRegistry } from "./provider-adapter";
import type { ExecutionMonitor } from "./execution-monitor";
import { DefaultActionPipeline } from "./action-pipeline";

/** The single entry point that composes everything else in the framework. */
export interface TaskEngine {
  execute(task: BrowserTask): Promise<TaskResult>;
  resume(runId: string): Promise<TaskResult>;
  pause(runId: string): Promise<void>;
  cancel(runId: string): Promise<void>;
}

/**
 * Not part of the plan's §5 interface list, but required for `resume(runId)` to work at all: the
 * framework needs *some* way to reload the `BrowserTask` a runId refers to. Kept persistence-
 * agnostic like `SessionStore`/`StateStore` — `modules/browser-automation/` supplies a Mongo-backed
 * implementation (`BrowserTaskRun.taskDefinition`); an in-memory default covers same-process use.
 */
export interface TaskStore {
  save(task: BrowserTask): Promise<void>;
  load(runId: string): Promise<BrowserTask | null>;
}

export class InMemoryTaskStore implements TaskStore {
  private readonly tasks = new Map<string, BrowserTask>();
  async save(task: BrowserTask): Promise<void> {
    this.tasks.set(task.id, task);
  }
  async load(runId: string): Promise<BrowserTask | null> {
    return this.tasks.get(runId) ?? null;
  }
}

export interface TaskEngineDependencies {
  eventBus: BrowserAutomationEventBus;
  providerRegistry: ProviderRegistry;
  sessionManager: SessionManager;
  stateEngine: StateEngine;
  recoveryEngine: RecoveryEngine;
  actionEngine: ActionEngine;
  /** A fresh BrowserManager per run — browsers are not shared across concurrent runs. */
  createBrowserManager: (runId: string) => BrowserManager;
  /** A fresh TabManager per run. */
  createTabManager: () => TabManager;
  taskStore?: TaskStore;
  executionMonitor?: ExecutionMonitor;
}

/**
 * Composes Browser Manager -> Session Manager -> Tab Manager -> Action Engine -> Action Pipeline
 * -> State Engine -> Recovery Engine -> Provider Adapter -> Event Bus, per
 * docs/BROWSER-AUTOMATION-FRAMEWORK-PLAN.md §3's sequence diagram. Contains no provider-specific
 * logic — it only ever calls through the ProviderAdapter interface.
 */
export class DefaultTaskEngine implements TaskEngine {
  private readonly taskStore: TaskStore;
  private readonly pauseRequested = new Set<string>();
  private readonly cancelRequested = new Set<string>();

  constructor(private readonly deps: TaskEngineDependencies) {
    this.taskStore = deps.taskStore ?? new InMemoryTaskStore();
  }

  async execute(task: BrowserTask): Promise<TaskResult> {
    await this.taskStore.save(task);
    return this.run(task, 0);
  }

  async resume(runId: string): Promise<TaskResult> {
    const task = await this.taskStore.load(runId);
    if (!task) throw new Error(`Cannot resume unknown run ${runId}`);
    const startIndex = await this.deps.stateEngine.resumePoint(runId);
    return this.run(task, startIndex);
  }

  async pause(runId: string): Promise<void> {
    this.pauseRequested.add(runId);
  }

  async cancel(runId: string): Promise<void> {
    this.cancelRequested.add(runId);
  }

  private async run(task: BrowserTask, startIndex: number): Promise<TaskResult> {
    const runId = task.id;
    const { eventBus, providerRegistry, sessionManager, recoveryEngine, actionEngine, executionMonitor } = this.deps;

    const provider = providerRegistry.get(task.providerId);
    if (!provider) throw new Error(`No provider registered for id "${task.providerId}"`);

    const validation = await provider.validate(task);
    if (!validation.valid) throw new Error(`Task ${task.id} failed provider validation: ${validation.reason ?? "unknown reason"}`);

    const browserManager = this.deps.createBrowserManager(runId);
    const tabManager = this.deps.createTabManager();
    const downloads: TaskResult["downloads"] = [];
    const screenshots: string[] = [];

    await this.transition(runId, "launching");
    await browserManager.launch();

    let context: BrowserContext;
    let page: Page;
    let tabId: string;
    try {
      const restored = task.sessionId ? await sessionManager.restore(task.sessionId) : null;
      const browser = browserManager.getBrowser();
      if (!browser) throw new Error("BrowserManager.launch() did not produce a browser instance");
      context = await browser.newContext(restored ? { storageState: restored.storageState as never } : undefined);
      tabId = await tabManager.openTab(context);
      page = await tabManager.switchTo(tabId);

      await this.transition(runId, "loading");
      await provider.initialize({ page, task });
      eventBus.emit({ runId, event: "PageLoaded", timestamp: new Date() });
      await this.transition(runId, "waiting");
    } catch (err) {
      await this.transition(runId, "failed");
      await browserManager.close();
      const message = err instanceof Error ? err.message : String(err);
      eventBus.emit({ runId, event: "ExecutionFinished", timestamp: new Date(), data: { error: message } });
      return {
        taskId: runId,
        state: "failed",
        completedSteps: 0,
        totalSteps: task.steps.length,
        error: message,
        failureStage: "setup",
        downloads,
        screenshots,
      };
    }

    const applyRecovery = async (action: RecoveryAction, recoveryContext: RecoveryContext): Promise<Page> => {
      if (action.type === "restart_browser") {
        await browserManager.restart();
        const browser = browserManager.getBrowser();
        if (!browser) throw new Error("BrowserManager.restart() did not produce a browser instance");
        context = await browser.newContext();
        tabId = await tabManager.openTab(context);
        return tabManager.switchTo(tabId);
      }
      if (action.type === "resume_state") {
        return tabManager.recover(tabId);
      }
      // "retry_action" and "abort" never reach here (handled inside ActionPipeline itself).
      void recoveryContext;
      return tabManager.switchTo(tabId);
    };

    const pipeline = new DefaultActionPipeline({ runId, eventBus, actionEngine, provider, recoveryEngine, applyRecovery });

    let completedSteps = startIndex;
    let finalState: ExecutionState = "completed";
    let error: string | undefined;

    for (let i = startIndex; i < task.steps.length; i += 1) {
      if (this.cancelRequested.has(runId)) {
        this.cancelRequested.delete(runId);
        finalState = "cancelled";
        break;
      }
      if (this.pauseRequested.has(runId)) {
        this.pauseRequested.delete(runId);
        finalState = "waiting";
        break;
      }

      await this.transition(runId, "executing");
      const step = task.steps[i];
      if (!step) break;
      const result = await pipeline.run(page, step);

      if (!result.success) {
        if (step.optional) {
          // Recorded, not fatal — see TaskStep.optional. The run continues to the next step, which
          // on a well-built sequence is the check that decides whether skipping this actually
          // mattered.
          if (executionMonitor) {
            await executionMonitor.record(runId, {
              level: "warn",
              message: `Optional step ${step.id} (${step.action}) did not succeed, continuing: ${result.error ?? "unknown reason"}`,
            });
          }
          completedSteps = i + 1;
          if (completedSteps < task.steps.length) await this.deps.stateEngine.transition(runId, "waiting", completedSteps);
          continue;
        }
        finalState = "failed";
        error = result.error;
        await this.transition(runId, "recovering");
        break;
      }

      completedSteps = i + 1;
      const hasMoreSteps = completedSteps < task.steps.length;
      // Diagram: Executing -> Waiting only when more steps remain; the last step goes straight to
      // Completed (Executing -> Completed), handled after the loop.
      if (hasMoreSteps) await this.deps.stateEngine.transition(runId, "waiting", completedSteps);

      // Module 7B: use the real path a provider's executeAction() returned (see
      // ProviderAdapter.executeAction's doc comment) rather than a placeholder — falls back to one
      // only if a provider genuinely didn't report one, so this stays non-breaking for adapters
      // that predate the extension.
      if (step.action === "download_file") {
        downloads.push({ path: (result.output?.downloadPath as string) ?? `download-${step.id}` });
      }
      if (step.action === "screenshot") {
        screenshots.push((result.output?.screenshotPath as string) ?? `screenshot-${step.id}`);
      }
      if (executionMonitor) await executionMonitor.record(runId, { level: "info", message: `Completed step ${step.id} (${step.action})` });
    }

    if (finalState === "failed") await this.transition(runId, "failed");
    else await this.deps.stateEngine.transition(runId, finalState, completedSteps);

    if (finalState === "completed" && task.sessionId) {
      await sessionManager.persist(task.sessionId, context);
    }

    await provider.shutdown();
    await browserManager.close();
    eventBus.emit({ runId, event: "ExecutionFinished", timestamp: new Date(), data: { state: finalState } });

    return {
      taskId: runId,
      state: finalState,
      completedSteps,
      totalSteps: task.steps.length,
      error,
      failureStage: finalState === "failed" ? "step" : undefined,
      downloads,
      screenshots,
    };
  }

  private async transition(runId: string, state: ExecutionState): Promise<void> {
    await this.deps.stateEngine.transition(runId, state);
  }
}
