import { CheckCircle2, CircleDashed, Loader2, OctagonX, RefreshCcw, UserRound, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { JobStatus } from "@/modules/jobs/models/Job";

const STATUS_CONFIG: Record<JobStatus, { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive"; icon: typeof CheckCircle2 }> = {
  queued: { label: "Queued", variant: "secondary", icon: CircleDashed },
  running: { label: "Running", variant: "default", icon: Loader2 },
  retrying: { label: "Retrying", variant: "warning", icon: RefreshCcw },
  manual_pending: { label: "Needs you", variant: "warning", icon: UserRound },
  completed: { label: "Completed", variant: "success", icon: CheckCircle2 },
  failed: { label: "Failed", variant: "destructive", icon: XCircle },
  cancelled: { label: "Cancelled", variant: "secondary", icon: OctagonX },
};

const SPINNING_STATUSES: JobStatus[] = ["running", "retrying"];

export function JobBadge({ status }: { status: JobStatus }) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <Badge variant={config.variant}>
      <Icon className={SPINNING_STATUSES.includes(status) ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
      {config.label}
    </Badge>
  );
}
