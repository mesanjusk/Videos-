"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronDown, Loader2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useJobPolling } from "@/hooks/use-job-polling";

export interface PlanSummary {
  id: string;
  request: string;
  pipelineId: string;
  status: string;
  costPolicy: string;
  notes: string[];
  stages: string[];
  objective: string;
  language: string;
  durationSeconds: number;
  aspectRatio: string;
  sceneCount: number;
  projectId: string | null;
  createdAt: string;
}

export interface PipelineOption {
  id: string;
  label: string;
  description: string;
  stages: string[];
}

/**
 * The whole product, on one screen: say what you want, press the button, watch it happen.
 *
 * ## What was removed, and why that is the feature
 *
 * This screen used to ask for five things before it would do anything: the idea, a pipeline, a cost
 * policy, a language and a duration. Four of those are questions only someone who has read the
 * architecture docs can answer, and every one of them already had a correct default. A person who
 * does not know what "BALANCED" means cannot pick between it and "FREE_PREFERRED", and making them
 * look at the choice does not teach them — it just stops them.
 *
 * They are all still here, under `More options`, closed. Nothing was taken away from the person who
 * wants it; it was taken out of the way of the person who does not.
 *
 * The plan step is also gone from the happy path. It existed as a spend guard — "nothing is
 * generated until you approve" — but it was guarding against a cost the user had already accepted by
 * pressing the button, and the thing it showed them (a stage list, a pipeline id) was not
 * information they could act on. Approval now happens in the same gesture as the request, and the
 * plan itself is visible on the project the moment it exists. `Review the plan first` restores the
 * old two-step flow for anyone who wants it.
 */
export function CreateVideoPanel({
  pipelines,
  recentPlans,
}: {
  pipelines: PipelineOption[];
  recentPlans: PlanSummary[];
}) {
  const router = useRouter();
  const [request, setRequest] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const [autoStart, setAutoStart] = useState(true);
  const [pipelineId, setPipelineId] = useState("auto");
  const [costPolicy, setCostPolicy] = useState("BALANCED");
  const [language, setLanguage] = useState("");
  const [durationSeconds, setDurationSeconds] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, startSubmit] = useTransition();

  // Planning is a model call, so the page polls the job rather than holding the request open.
  const { job } = useJobPolling(jobId);

  useEffect(() => {
    if (job?.status !== "completed") return;
    setJobId(null);

    // The planner records the plan it wrote on the job result (production-plan.processor.ts).
    // Approving it here is what makes the whole thing one press instead of two — and it is the same
    // call the old Approve button made, so a plan that cannot be approved still surfaces its own
    // error rather than failing silently.
    const resultPlanId = job.result?.planId as string | undefined;
    if (!autoStart || !resultPlanId) {
      router.refresh();
      return;
    }

    (async () => {
      const res = await fetch(`/api/production/plans/${resultPlanId}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "The plan was written but could not be started.");
        router.refresh();
        return;
      }
      router.push(`/projects/${body.projectId}`);
    })();
  }, [job?.status, job?.result, autoStart, router]);

  const planningFailed = job?.status === "failed";
  const isWorking = isSubmitting || (!!jobId && !planningFailed);

  const submit = () => {
    setError(null);
    startSubmit(async () => {
      const response = await fetch("/api/production/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request,
          pipelineId: pipelineId === "auto" ? undefined : pipelineId,
          costPolicy,
          language: language || undefined,
          durationSeconds: durationSeconds ? Number(durationSeconds) : undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? "Could not start.");
        return;
      }
      setJobId(body.jobId);
    });
  };

  const draftPlans = recentPlans.filter((p) => p.status === "draft");
  const runningPlans = recentPlans.filter((p) => p.projectId && p.status !== "draft").slice(0, 4);

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center gap-8 py-8">
      <div className="space-y-6 text-center">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">What should we make?</h1>

        <Textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          rows={3}
          disabled={isWorking}
          className="resize-none rounded-2xl border-2 p-5 text-center text-lg shadow-sm focus-visible:ring-2"
          placeholder="A brave little turtle who learns to swim"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && request.trim().length >= 8) submit();
          }}
        />

        <Button size="lg" className="h-16 w-full text-lg" onClick={submit} disabled={request.trim().length < 8 || isWorking}>
          {isWorking ? <Loader2 className="h-5 w-5 animate-spin" /> : <Wand2 className="h-5 w-5" />}
          {isWorking ? "Getting started…" : "Make it"}
        </Button>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {planningFailed && (
          <p className="text-sm text-destructive">
            {job?.error ?? "That didn't work. Try describing it a different way."}
          </p>
        )}
      </div>

      {draftPlans.length > 0 && (
        <div className="space-y-2">
          {draftPlans.map((plan) => (
            <DraftPlanRow key={plan.id} plan={plan} />
          ))}
        </div>
      )}

      {runningPlans.length > 0 && (
        <div className="space-y-1">
          {runningPlans.map((plan) => (
            <Link
              key={plan.id}
              href={`/projects/${plan.projectId}`}
              className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <span className="truncate">{plan.objective}</span>
              <span className="shrink-0 text-xs">{plan.status === "completed" ? "done" : "making…"}</span>
            </Link>
          ))}
        </div>
      )}

      <details
        className="mx-auto w-full max-w-md"
        open={showOptions}
        onToggle={(e) => setShowOptions((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="flex cursor-pointer list-none items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          More options
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showOptions ? "rotate-180" : ""}`} />
        </summary>

        <div className="mt-4 grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2">
          <label className="col-span-full flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={!autoStart}
              onChange={(e) => setAutoStart(!e.target.checked)}
            />
            Review the plan before it starts
          </label>

          <Field label="Style">
            <Select value={pipelineId} onValueChange={setPipelineId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Choose for me</SelectItem>
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Spending">
            <Select value={costPolicy} onValueChange={setCostPolicy}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ZERO_COST">Free only</SelectItem>
                <SelectItem value="FREE_PREFERRED">Free when possible</SelectItem>
                <SelectItem value="BALANCED">Balanced</SelectItem>
                <SelectItem value="BEST_QUALITY">Best quality</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Language">
            <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="English" />
          </Field>

          <Field label="Length">
            <Input
              type="number"
              min={5}
              max={3600}
              value={durationSeconds}
              onChange={(e) => setDurationSeconds(e.target.value)}
              placeholder="60 seconds"
            />
          </Field>
        </div>
      </details>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

/** A plan someone asked to review. Two buttons: make it, or bin it. */
function DraftPlanRow({ plan }: { plan: PlanSummary }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const act = (method: "POST" | "DELETE") =>
    startTransition(async () => {
      setError(null);
      const response = await fetch(`/api/production/plans/${plan.id}`, { method });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "That did not work.");
        return;
      }
      if (method === "POST" && body.projectId) router.push(`/projects/${body.projectId}`);
      else router.refresh();
    });

  return (
    <div className="rounded-xl border border-border p-4">
      <p className="font-medium">{plan.objective}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {plan.sceneCount} scenes · {plan.durationSeconds}s · {plan.language}
      </p>
      {plan.notes.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{plan.notes[0]}</p>}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" disabled={isPending} onClick={() => act("POST")}>
          {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          Make it
        </Button>
        <Button size="sm" variant="ghost" disabled={isPending} onClick={() => act("DELETE")}>
          No thanks
        </Button>
      </div>
    </div>
  );
}
