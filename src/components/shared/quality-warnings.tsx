import { AlertTriangle } from "lucide-react";
import type { PolledJob } from "@/hooks/use-job-polling";
import type { QualityIssue } from "@/core/quality/types";

/** Renders warning-severity core/quality issues a processor recorded on Job.result.qualityIssues —
 * see docs/MOVIE-STUDIO-ROADMAP.md Module 5. Error-severity issues never reach the client this way:
 * they're thrown as QualityCheckFailedError and surface as the job's own "failed"/error message
 * instead, handled separately by each caller. */
export function QualityWarnings({ job }: { job: PolledJob | null }) {
  const issues = (job?.result?.qualityIssues as QualityIssue[] | undefined)?.filter((i) => i.severity === "warning");
  if (!issues || issues.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5">
      {issues.map((issue, i) => (
        <li key={i} className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {issue.message}
        </li>
      ))}
    </ul>
  );
}
