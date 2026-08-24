import { requireUserId } from "@/core/auth/session";
import { listBrowserTaskRuns, listBrowserSessions, listBrowserProviderConfigs } from "@/modules/browser-automation/service";
import { browserProviderRegistry } from "@/core/browser/provider-adapter";
import { HelpButton } from "@/components/shared/help-button";
import {
  BrowserAutomationManager,
  type BrowserProviderConfigItem,
  type BrowserSessionItem,
  type BrowserTaskRunItem,
  type RegisteredProviderItem,
} from "./browser-automation-manager";
import type { BrowserTask } from "@/core/browser/types";

export default async function BrowserAutomationPage() {
  const userId = await requireUserId();
  const [runs, sessions, configs] = await Promise.all([
    listBrowserTaskRuns(userId),
    listBrowserSessions(userId),
    listBrowserProviderConfigs(userId),
  ]);
  const registered: RegisteredProviderItem[] = browserProviderRegistry.list().map((a) => ({ id: a.id, label: a.label }));

  const runItems: BrowserTaskRunItem[] = runs.map((run) => {
    const task = run.taskDefinition as BrowserTask | undefined;
    const currentStep = task?.steps?.[run.currentStepIndex ?? 0];
    return {
      id: run._id.toString(),
      providerId: run.providerId,
      state: run.state as BrowserTaskRunItem["state"],
      currentStepIndex: run.currentStepIndex ?? 0,
      totalSteps: run.totalSteps ?? task?.steps?.length ?? 0,
      currentStepLabel: currentStep ? `${currentStep.action} (${currentStep.id})` : null,
      currentUrl: currentStep?.action === "navigate" ? (currentStep.params?.url as string | undefined) ?? null : null,
      error: run.error ?? undefined,
      retryCount: run.retryCount ?? 0,
      downloads: (run.downloads ?? []).map((d) => ({ path: d.path, url: d.url ?? undefined })),
      screenshots: run.screenshots ?? [],
      createdAt: run.createdAt.toISOString(),
      updatedAt: run.updatedAt.toISOString(),
    };
  });

  const sessionItems: BrowserSessionItem[] = sessions.map((s) => ({
    id: s._id.toString(),
    providerId: s.providerId,
    label: s.label,
    connectedAt: s.connectedAt ? s.connectedAt.toISOString() : s.createdAt.toISOString(),
    lastUsedAt: s.lastUsedAt ? s.lastUsedAt.toISOString() : null,
  }));

  const configItems: BrowserProviderConfigItem[] = configs.map((c) => ({
    id: c._id.toString(),
    providerId: c.providerId,
    label: c.label,
    enabled: c.enabled ?? true,
    timeoutMs: c.timeoutMs ?? 60_000,
    maxAttempts: c.maxAttempts ?? 3,
    backoffMs: c.backoffMs ?? 2_000,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Browser Automation</h1>
        <HelpButton text="The provider-agnostic execution engine behind browser-driven video providers (Google Flow today, others later). Every task here runs through the same Browser Manager → Session Manager → Tab Manager → Action Pipeline → Recovery Engine pipeline, regardless of which provider adapter is registered." />
      </div>
      <p className="text-sm text-muted-foreground">
        {registered.length === 0
          ? "No provider adapters are registered in this deployment yet — any task will fail immediately with an honest error, by design."
          : `${registered.length} provider adapter${registered.length === 1 ? "" : "s"} registered.`}
      </p>

      <BrowserAutomationManager runs={runItems} sessions={sessionItems} configs={configItems} registered={registered} />
    </div>
  );
}
