"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { JobBadge } from "@/components/shared/job-badge";
import type { JobStatus, JobType } from "@/modules/jobs/models/Job";

export interface RecentActivityItem {
  id: string;
  type: JobType;
  status: JobStatus;
}

export function RecentActivity({ jobs }: { jobs: RecentActivityItem[] }) {
  const router = useRouter();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function cancel(jobId: string) {
    setCancellingId(jobId);
    await fetch(`/api/jobs/${jobId}`, { method: "DELETE" }).catch(() => {});
    setCancellingId(null);
    router.refresh();
  }

  if (jobs.length === 0) {
    return <EmptyState icon={Activity} title="Nothing yet" description="Generation jobs will show up here as soon as you start a project." />;
  }

  return (
    <ul className="space-y-3">
      {jobs.map((job) => (
        <li key={job.id} className="flex items-center justify-between gap-3 text-sm">
          <span className="truncate text-muted-foreground">{job.type.replace(/_/g, " ")}</span>
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
