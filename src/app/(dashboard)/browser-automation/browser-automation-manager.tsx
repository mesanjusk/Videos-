"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Bot, Download, Loader2, Pause, Play, Plug, Plus, RotateCcw, ScrollText, SquareX, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { BrowserTaskBadge } from "@/components/shared/browser-task-badge";
import { createBrowserSessionSchema, executeBrowserTaskSchema, type CreateBrowserSessionInput } from "@/modules/browser-automation/schema";
import type { BrowserTaskRunState } from "@/modules/browser-automation/constants";

export interface BrowserTaskRunItem {
  id: string;
  providerId: string;
  state: BrowserTaskRunState;
  currentStepIndex: number;
  totalSteps: number;
  currentStepLabel: string | null;
  currentUrl: string | null;
  error?: string;
  retryCount: number;
  downloads: { path: string; url?: string }[];
  screenshots: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BrowserSessionItem {
  id: string;
  providerId: string;
  label: string;
  connectedAt: string;
  lastUsedAt?: string | null;
}

export interface BrowserProviderConfigItem {
  id: string;
  providerId: string;
  label: string;
  enabled: boolean;
  timeoutMs: number;
  maxAttempts: number;
  backoffMs: number;
}

export interface RegisteredProviderItem {
  id: string;
  label: string;
}

const RUN_STATUS_CHIPS: { state: BrowserTaskRunState | "all"; label: string }[] = [
  { state: "all", label: "All" },
  { state: "waiting", label: "Waiting" },
  { state: "executing", label: "Running" },
  { state: "recovering", label: "Recovering" },
  { state: "completed", label: "Completed" },
  { state: "failed", label: "Failed" },
  { state: "cancelled", label: "Cancelled" },
];

interface ExecutionLogItem {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: string;
}

export function BrowserAutomationManager({
  runs,
  sessions,
  configs,
  registered,
}: {
  runs: BrowserTaskRunItem[];
  sessions: BrowserSessionItem[];
  configs: BrowserProviderConfigItem[];
  registered: RegisteredProviderItem[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<BrowserTaskRunState | "all">("all");
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [logsByRun, setLogsByRun] = useState<Record<string, ExecutionLogItem[]>>({});
  const [logsLoading, setLogsLoading] = useState(false);

  const filtered = filter === "all" ? runs : runs.filter((r) => r.state === filter);

  async function runAction(runId: string, action: "pause" | "resume" | "cancel" | "restart") {
    setPendingRunId(runId);
    await fetch(`/api/browser-automation/tasks/${runId}/${action}`, { method: "POST" }).catch(() => {});
    setPendingRunId(null);
    router.refresh();
  }

  async function deleteSession(id: string) {
    await fetch(`/api/browser-automation/sessions/${id}`, { method: "DELETE" }).catch(() => {});
    router.refresh();
  }

  async function toggleLogs(runId: string) {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(runId);
    if (!logsByRun[runId]) {
      setLogsLoading(true);
      const res = await fetch(`/api/browser-automation/tasks/${runId}/logs`).catch(() => null);
      const body = res ? await res.json().catch(() => null) : null;
      setLogsByRun((prev) => ({ ...prev, [runId]: body?.logs ?? [] }));
      setLogsLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Provider Status</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {registered.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No provider adapters registered — this ships as a generic execution engine only. A future module registers a
              real adapter (e.g. Google Flow) against this same framework.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {registered.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <Badge variant="success">
                    <Plug className="h-3 w-3" />
                    Registered
                  </Badge>
                  <span className="font-medium">{p.label}</span>
                  <span className="text-xs text-muted-foreground">{p.id}</span>
                </li>
              ))}
            </ul>
          )}
          {configs.length > 0 && (
            <div className="border-t border-border pt-3">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Saved provider configs</p>
              <ul className="space-y-1">
                {configs.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={c.enabled ? "secondary" : "outline"}>{c.enabled ? "Enabled" : "Disabled"}</Badge>
                    {c.label} ({c.providerId}) · {c.timeoutMs}ms timeout · {c.maxAttempts} attempts
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Session Status</CardTitle>
          <Dialog open={sessionDialogOpen} onOpenChange={setSessionDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="h-4 w-4" />
                Connect session
              </Button>
            </DialogTrigger>
            <DialogContent>
              <ConnectSessionForm onSuccess={() => { setSessionDialogOpen(false); router.refresh(); }} />
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No browser sessions saved. A session is a Playwright <code className="rounded bg-muted px-1 py-0.5 text-xs">storageState()</code> export captured from a manual login — never automated by this framework.
            </p>
          ) : (
            <ul className="space-y-2">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{s.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.providerId} · connected {new Date(s.connectedAt).toLocaleDateString()}
                      {s.lastUsedAt ? ` · last used ${new Date(s.lastUsedAt).toLocaleDateString()}` : ""}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Delete session" onClick={() => deleteSession(s.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Browser Tasks</CardTitle>
          <Dialog open={taskDialogOpen} onOpenChange={setTaskDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Play className="h-4 w-4" />
                Execute task
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <ExecuteTaskForm
                sessions={sessions}
                onSuccess={() => { setTaskDialogOpen(false); router.refresh(); }}
              />
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {RUN_STATUS_CHIPS.map((chip) => (
              <button
                key={chip.state}
                type="button"
                onClick={() => setFilter(chip.state)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  filter === chip.state ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent"
                }`}
              >
                {chip.label} ({chip.state === "all" ? runs.length : runs.filter((r) => r.state === chip.state).length})
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon={Bot} title="No browser tasks" description="Nothing matches this filter right now." />
          ) : (
            <ul className="space-y-2">
              {filtered.map((run) => (
                <li key={run.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {run.providerId} · step {Math.min(run.currentStepIndex + 1, run.totalSteps)}/{run.totalSteps || 0}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {run.currentStepLabel ?? "No current action"}
                        {run.currentUrl ? ` — ${run.currentUrl}` : ""}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {new Date(run.updatedAt).toLocaleString()}
                        {run.retryCount > 0 ? ` · ${run.retryCount} retries` : ""}
                      </p>
                      {run.error && <p className="mt-1 text-xs text-destructive">{run.error}</p>}
                      {run.state === "recovering" && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Recovery in progress…</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <BrowserTaskBadge state={run.state} />
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {(run.state === "waiting" || run.state === "executing") && (
                      <Button variant="outline" size="sm" className="h-7" disabled={pendingRunId === run.id} onClick={() => runAction(run.id, "pause")}>
                        <Pause className="h-3 w-3" />
                        Pause
                      </Button>
                    )}
                    {run.state === "waiting" && (
                      <Button variant="outline" size="sm" className="h-7" disabled={pendingRunId === run.id} onClick={() => runAction(run.id, "resume")}>
                        <Play className="h-3 w-3" />
                        Resume
                      </Button>
                    )}
                    {(run.state === "idle" || run.state === "waiting" || run.state === "executing" || run.state === "recovering") && (
                      <Button variant="outline" size="sm" className="h-7" disabled={pendingRunId === run.id} onClick={() => runAction(run.id, "cancel")}>
                        <SquareX className="h-3 w-3" />
                        Cancel
                      </Button>
                    )}
                    {(run.state === "failed" || run.state === "cancelled") && (
                      <Button variant="outline" size="sm" className="h-7" disabled={pendingRunId === run.id} onClick={() => runAction(run.id, "restart")}>
                        <RotateCcw className="h-3 w-3" />
                        Restart
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-7" onClick={() => toggleLogs(run.id)}>
                      <ScrollText className="h-3 w-3" />
                      {expandedRunId === run.id ? "Hide log" : "View log"}
                    </Button>
                    {run.downloads.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Download className="h-3 w-3" />
                        {run.downloads.length} download{run.downloads.length === 1 ? "" : "s"}
                      </span>
                    )}
                    {run.screenshots.length > 0 && (
                      <span className="text-xs text-muted-foreground">{run.screenshots.length} screenshot{run.screenshots.length === 1 ? "" : "s"}</span>
                    )}
                  </div>

                  {expandedRunId === run.id && (
                    <div className="mt-2 max-h-56 overflow-y-auto rounded-md bg-muted/50 p-2 font-mono text-xs">
                      {logsLoading && !logsByRun[run.id] ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (logsByRun[run.id]?.length ?? 0) === 0 ? (
                        <p className="text-muted-foreground">No execution log entries yet.</p>
                      ) : (
                        logsByRun[run.id]!.slice()
                          .reverse()
                          .map((entry, i) => (
                            <p key={i} className={entry.level === "error" ? "text-destructive" : "text-muted-foreground"}>
                              [{new Date(entry.timestamp).toLocaleTimeString()}] {entry.message}
                            </p>
                          ))
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ConnectSessionForm({ onSuccess }: { onSuccess: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateBrowserSessionInput>({ resolver: zodResolver(createBrowserSessionSchema) });

  async function onSubmit(values: CreateBrowserSessionInput) {
    setServerError(null);
    const res = await fetch("/api/browser-automation/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setServerError(body.error ?? "Failed to save this session");
      return;
    }
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <DialogHeader>
        <DialogTitle>Connect a browser session</DialogTitle>
        <DialogDescription>
          Paste a Playwright <code className="rounded bg-muted px-1 py-0.5 text-xs">storageState()</code> export captured
          from a manual login. This framework never automates a login itself. Encrypted at rest.
        </DialogDescription>
      </DialogHeader>
      <div className="mt-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="providerId">Provider id</Label>
          <Input id="providerId" placeholder="e.g. google-flow" {...register("providerId")} />
          {errors.providerId && <p className="text-xs text-destructive">{errors.providerId.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="label">Label</Label>
          <Input id="label" placeholder="e.g. Personal account" {...register("label")} />
          {errors.label && <p className="text-xs text-destructive">{errors.label.message}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="storageStateJson">storageState() JSON</Label>
          <Textarea id="storageStateJson" rows={6} placeholder='{"cookies": [...], "origins": [...]}' {...register("storageStateJson")} />
          {errors.storageStateJson && <p className="text-xs text-destructive">{errors.storageStateJson.message}</p>}
        </div>
        {serverError && <p className="text-sm text-destructive">{serverError}</p>}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Save session
        </Button>
      </DialogFooter>
    </form>
  );
}

function ExecuteTaskForm({ sessions, onSuccess }: { sessions: BrowserSessionItem[]; onSuccess: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [providerId, setProviderId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [stepsJson, setStepsJson] = useState('[\n  { "id": "step-1", "action": "navigate", "params": { "url": "https://example.com" } }\n]');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setServerError(null);

    let steps: unknown;
    try {
      steps = JSON.parse(stepsJson);
    } catch {
      setServerError("Steps must be valid JSON.");
      return;
    }

    const parsed = executeBrowserTaskSchema.safeParse({ providerId, sessionId: sessionId || undefined, steps });
    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? "Invalid task definition.");
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/browser-automation/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setServerError(body.error ?? "Failed to enqueue this task.");
      return;
    }
    onSuccess();
  }

  return (
    <form onSubmit={onSubmit}>
      <DialogHeader>
        <DialogTitle>Execute a browser task</DialogTitle>
        <DialogDescription>
          Advanced/testing entry point — enqueues a `browser_task` job on the Scene Queue. With no provider adapter
          registered yet, this will fail immediately with an honest &ldquo;no provider registered&rdquo; error.
        </DialogDescription>
      </DialogHeader>
      <div className="mt-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="taskProviderId">Provider id</Label>
          <Input id="taskProviderId" placeholder="e.g. google-flow" value={providerId} onChange={(e) => setProviderId(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="taskSessionId">Session (optional)</Label>
          <select
            id="taskSessionId"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
          >
            <option value="">None</option>
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} ({s.providerId})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="taskSteps">Steps (JSON array of TaskStep)</Label>
          <Textarea id="taskSteps" rows={8} className="font-mono text-xs" value={stepsJson} onChange={(e) => setStepsJson(e.target.value)} />
        </div>
        {serverError && <p className="text-sm text-destructive">{serverError}</p>}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Execute
        </Button>
      </DialogFooter>
    </form>
  );
}
