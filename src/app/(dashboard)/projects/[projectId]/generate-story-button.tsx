"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useJobPolling } from "@/hooks/use-job-polling";

export function GenerateStoryButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [jobId, setJobId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { job, isDone } = useJobPolling(jobId);

  useEffect(() => {
    if (isDone && job?.status === "completed") {
      router.refresh();
    }
  }, [isDone, job?.status, router]);

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

  const isWorking = starting || (job && !isDone);

  return (
    <div className="flex flex-col items-center gap-2">
      <Button onClick={start} disabled={!!isWorking}>
        {isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {isWorking ? "Writing your story..." : "Generate story"}
      </Button>
      {job?.status === "failed" && (
        <p className="text-sm text-destructive">{job.error ?? "Story generation failed. Please try again."}</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
