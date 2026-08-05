"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ListChecks, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { JobBadge } from "@/components/shared/job-badge";
import type { JobStatus, JobType } from "@/modules/jobs/models/Job";

export interface QueueJobItem {
  id: string;
  type: JobType;
  status: JobStatus;
  attempts: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
  projectId: string;
  projectTitle: string;
  characterName?: string;
}

export function QueueManager({ jobs }: { jobs: QueueJobItem[] }) {
  const router = useRouter();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function cancel(jobId: string) {
    setCancellingId(jobId);
    await fetch(`/api/jobs/${jobId}`, { method: "DELETE" }).catch(() => {});
    setCancellingId(null);
    router.refresh();
  }

  if (jobs.length === 0) {
    return <EmptyState icon={ListChecks} title="No jobs here" description="Nothing matches this filter right now." />;
  }

  return (
    <ul className="space-y-2">
      {jobs.map((job) => (
        <li key={job.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3 text-sm">
          <div className="min-w-0">
            <p className="truncate">
              {job.type.replace(/_/g, " ")}
              {job.characterName ? ` — ${job.characterName}` : ""}
            </p>
            <Link href={`/projects/${job.projectId}`} className="truncate text-xs text-muted-foreground hover:underline">
              {job.projectTitle}
            </Link>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {new Date(job.updatedAt).toLocaleString()}
              {job.attempts > 0 ? ` · attempt ${job.attempts}` : ""}
            </p>
            {job.error && <p className="mt-1 text-xs text-destructive">{job.error}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <JobBadge status={job.status} />
            {job.status === "queued" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label="Cancel this queued job"
                disabled={cancellingId === job.id}
                onClick={() => cancel(job.id)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
