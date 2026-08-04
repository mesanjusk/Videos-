"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useJobPolling } from "@/hooks/use-job-polling";

/** After this long still "queued"/"running", show the cancel option instead of just spinning forever. */
const STUCK_AFTER_MS = 20_000;

export function GenerateStoryButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);
  const { job, isDone, error: pollError } = useJobPolling(jobId);

  useEffect(() => {
    if (isDone && job?.status === "completed") {
      router.refresh();
    }
  }, [isDone, job?.status, router]);

  useEffect(() => {
    setStuck(false);
    if (!jobId || isDone) return;
    const timer = setTimeout(() => setStuck(true), STUCK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [jobId, isDone]);

  async function start() {
    setStarting(true);
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/story`, { method: "POST" });
    setStarting(false);
    if (!res.ok) {
      setError("Couldn't start story generation. Please try again.");
      return;
    }
    const { job: created } = await res.json();
    setJobId(created._id);
  }

  async function cancel() {
    if (!jobId) return;
    setCancelling(true);
    setError(null);
    const res = await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
    setCancelling(false);
    if (res.ok) {
      setJobId(null);
      setStuck(false);
      return;
    }
    const body = await res.json().catch(() => ({}));
    setError(body.error ?? "Couldn't cancel — it may have just started processing. Try again in a moment.");
  }

  const isWorking = starting || (job && !isDone);

  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-3">
      {isWorking && <Progress value={null} />}
      <Button onClick={start} disabled={!!isWorking}>
        {isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {isWorking ? "Writing your story..." : "Generate story"}
      </Button>

      {isWorking && stuck && (
        <div className="flex flex-col items-center gap-1.5 text-center">
          <p className="text-xs text-muted-foreground">
            {job?.status === "running"
              ? "This is taking longer than expected — it's in progress and should finish soon."
              : "This is taking longer than expected."}
          </p>
          {job?.status === "queued" && (
            <Button variant="outline" size="sm" onClick={cancel} disabled={cancelling}>
              {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
              Cancel and try again
            </Button>
          )}
        </div>
      )}

      {job?.status === "failed" && (
        <p className="text-sm text-destructive">{job.error ?? "Story generation failed. Please try again."}</p>
      )}
      {pollError && <p className="text-sm text-destructive">{pollError}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
