"use client";

import { useEffect, useRef, useState } from "react";
import type { JobStatus, JobType } from "@/modules/jobs/models/Job";

export interface PolledJob {
  _id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  error?: string;
  result?: Record<string, unknown>;
}

const TERMINAL_STATUSES: JobStatus[] = ["completed", "failed", "cancelled"];

/** Polls GET /api/jobs/:id every `intervalMs` until the job reaches a terminal status. */
export function useJobPolling(jobId: string | null, intervalMs = 2500) {
  const [job, setJob] = useState<PolledJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) throw new Error("Failed to check job status");
        const { job: latest } = await res.json();
        if (cancelled) return;
        setJob(latest);
        if (!TERMINAL_STATUSES.includes(latest.status)) {
          timerRef.current = setTimeout(poll, intervalMs);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to check job status");
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [jobId, intervalMs]);

  return { job, error, isDone: job ? TERMINAL_STATUSES.includes(job.status) : false };
}
