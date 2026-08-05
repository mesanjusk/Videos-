import type { Job as BullJob } from "bullmq";
import { withJobLifecycle, type BullJobData, type ProcessorResult } from "./helpers";
import { InMemoryEventBus } from "@/core/browser-automation/event-bus";
import { PlaywrightBrowserManager } from "@/core/browser-automation/browser-manager";
import { DefaultTabManager } from "@/core/browser-automation/tab-manager";
import { DefaultSessionManager } from "@/core/browser-automation/session-manager";
import { PlaywrightActionEngine } from "@/core/browser-automation/action-engine";
import { DefaultStateEngine } from "@/core/browser-automation/state-engine";
import { DefaultRecoveryEngine } from "@/core/browser-automation/recovery-engine";
import { EventBusExecutionMonitor } from "@/core/browser-automation/execution-monitor";
import { browserProviderRegistry } from "@/core/browser-automation/provider-adapter";
import { DefaultTaskEngine } from "@/core/browser-automation/task-engine";
import { MongoSessionStore, MongoStateStore, MongoTaskStore, PersistingExecutionMonitor } from "@/modules/browser-automation/service";
import { BrowserTaskRun } from "@/modules/browser-automation/models/BrowserTaskRun";

/**
 * The `browser_task` job type's processor — deliberately the only file (besides
 * `core/browser-automation/*` itself) that imports the framework, and registered only in
 * `core/queue/worker-only-processors.ts` (same Playwright-isolation rule as Module 4's
 * `scene_video_auto`). Composes the framework's DI-friendly pieces with their Mongo-backed
 * implementations; contains no provider-specific logic itself.
 *
 * With no adapter registered in `browserProviderRegistry` yet (Module 7A ships zero providers —
 * see docs/BROWSER-AUTOMATION-FRAMEWORK-PLAN.md §7/§8), every job here fails immediately and
 * honestly with "No provider registered for id ...".
 */
export async function processBrowserTaskJob(bullJob: BullJob<BullJobData>): Promise<ProcessorResult> {
  return withJobLifecycle(bullJob, async (jobDoc) => {
    const runId = jobDoc._id.toString();
    const resumeRunId = (jobDoc.payload as { resumeRunId?: string } | undefined)?.resumeRunId;

    const eventBus = new InMemoryEventBus();
    const taskStore = new MongoTaskStore();
    const taskEngine = new DefaultTaskEngine({
      eventBus,
      providerRegistry: browserProviderRegistry,
      sessionManager: new DefaultSessionManager(new MongoSessionStore(jobDoc.userId)),
      stateEngine: new DefaultStateEngine(new MongoStateStore()),
      recoveryEngine: new DefaultRecoveryEngine(),
      actionEngine: new PlaywrightActionEngine(),
      createBrowserManager: (id) => new PlaywrightBrowserManager(id, eventBus),
      createTabManager: () => new DefaultTabManager(),
      taskStore,
      executionMonitor: new PersistingExecutionMonitor(new EventBusExecutionMonitor(eventBus)),
    });

    // Cross-process cooperative cancel/pause: the API route that set BrowserTaskRun's flags runs on
    // Vercel and has no access to this worker's in-memory TaskEngine — poll the flag it can reach
    // instead. See modules/browser-automation/service.ts#requestCancelBrowserTask.
    const targetRunId = resumeRunId ?? runId;
    const pollTimer = setInterval(() => {
      BrowserTaskRun.findById(targetRunId)
        .select("cancelRequested pauseRequested")
        .lean()
        .then((run) => {
          if (run?.cancelRequested) return taskEngine.cancel(targetRunId);
          if (run?.pauseRequested) return taskEngine.pause(targetRunId);
        })
        .catch(() => {
          // best-effort — a missed poll just delays the pause/cancel taking effect
        });
    }, 3000);

    try {
      const result = resumeRunId
        ? await taskEngine.resume(resumeRunId)
        : await (async () => {
            const task = await taskStore.load(runId);
            if (!task) throw new Error(`BrowserTaskRun ${runId} has no taskDefinition — was enqueueBrowserTask() used to create it?`);
            return taskEngine.execute(task);
          })();

      // A TaskResult in a non-"completed" state is a real failure, not a thrown exception — surface
      // it the same way every other processor's failures reach withJobLifecycle, so Job.status
      // ends up "failed"/"retrying" instead of a false "completed".
      if (result.state !== "completed") {
        throw new Error(result.error ?? `Browser task ended in state "${result.state}"`);
      }
      return { status: "completed", ...result };
    } finally {
      clearInterval(pollTimer);
    }
  });
}
