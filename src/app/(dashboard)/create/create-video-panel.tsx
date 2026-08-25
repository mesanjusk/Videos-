"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

const COST_POLICY_HELP: Record<string, string> = {
  ZERO_COST: "Only providers that cost nothing. Refuses to run rather than falling back to a paid one.",
  FREE_PREFERRED: "Prefers free providers, but will use a paid one when no free route exists.",
  BALANCED: "Uses whatever is configured as preferred. The default.",
  BEST_QUALITY: "Picks the best provider available, paid or not.",
};

export function CreateVideoPanel({
  pipelines,
  recentPlans,
}: {
  pipelines: PipelineOption[];
  recentPlans: PlanSummary[];
}) {
  const router = useRouter();
  const [request, setRequest] = useState("");
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
    router.refresh();
  }, [job?.status, router]);

  const planningFailed = job?.status === "failed";

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
        setError(body.error ?? "Could not start planning.");
        return;
      }
      setJobId(body.jobId);
    });
  };

  const isPlanning = isSubmitting || (!!jobId && job?.status !== "failed");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            One line in, a plan out
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="request">What should the video be?</Label>
            <Textarea
              id="request"
              rows={3}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              placeholder="Create a 60-second Hindi Instagram Reel explaining the logic behind Sehra in Indian weddings."
            />
            <p className="text-xs text-muted-foreground">
              Nothing is generated yet. You will see the plan — research, script, scenes, assets, voice, render — and
              can change or cancel it before anything runs.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Pipeline</Label>
              <Select value={pipelineId} onValueChange={setPipelineId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Choose for me</SelectItem>
                  {pipelines.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {pipelineId === "auto"
                  ? "Picked from your wording. You can change it before approving."
                  : pipelines.find((p) => p.id === pipelineId)?.description}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Cost policy</Label>
              <Select value={costPolicy} onValueChange={setCostPolicy}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.keys(COST_POLICY_HELP).map((policy) => (
                    <SelectItem key={policy} value={policy}>{policy.replace(/_/g, " ").toLowerCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{COST_POLICY_HELP[costPolicy]}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="language">Language (optional)</Label>
              <Input id="language" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="hi-IN" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="duration">Duration in seconds (optional)</Label>
              <Input
                id="duration"
                type="number"
                min={5}
                max={3600}
                value={durationSeconds}
                onChange={(e) => setDurationSeconds(e.target.value)}
                placeholder="60"
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {planningFailed && (
            <p className="text-sm text-destructive">
              Planning failed: {job?.error ?? "unknown error"}. Under a zero-cost policy this usually means no free
              provider is configured for text generation.
            </p>
          )}

          <Button onClick={submit} disabled={request.trim().length < 8 || isPlanning}>
            {isPlanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
            {isPlanning ? "Planning…" : "Plan this video"}
          </Button>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Recent plans</h2>
        {recentPlans.length === 0 ? (
          <p className="text-sm text-muted-foreground">No plans yet.</p>
        ) : (
          recentPlans.map((plan) => <PlanCard key={plan.id} plan={plan} />)
        )}
      </section>
    </div>
  );
}

function PlanCard({ plan }: { plan: PlanSummary }) {
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
      router.refresh();
    });

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-sm font-medium">{plan.objective}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={plan.status === "draft" ? "secondary" : "outline"}>{plan.status}</Badge>
            <Badge variant="outline">{plan.costPolicy.replace(/_/g, " ").toLowerCase()}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{plan.request}</p>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          <Stat label="Pipeline" value={plan.pipelineId.replace(/_/g, " ")} />
          <Stat label="Language" value={plan.language} />
          <Stat label="Duration" value={`${plan.durationSeconds}s`} />
          <Stat label="Scenes" value={String(plan.sceneCount)} />
        </dl>

        {plan.stages.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {plan.stages.map((stage) => (
              <span key={stage} className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">{stage}</span>
            ))}
          </div>
        )}

        {plan.notes.length > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
            <p className="mb-1 font-medium">The director adjusted this plan:</p>
            <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
              {plan.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex flex-wrap items-center gap-2">
          {plan.status === "draft" && (
            <>
              <Button size="sm" disabled={isPending} onClick={() => act("POST")}>
                {isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
                Approve and start
              </Button>
              <Button size="sm" variant="ghost" disabled={isPending} onClick={() => act("DELETE")}>
                Discard
              </Button>
            </>
          )}
          {plan.projectId && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/projects/${plan.projectId}`}>Open project</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
