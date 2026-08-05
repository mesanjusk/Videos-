import { CheckCircle2, CircleDashed, Loader2, OctagonX, RefreshCcw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { BrowserTaskRunState } from "@/modules/browser-automation/constants";

const STATUS_CONFIG: Record<
  BrowserTaskRunState,
  { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive"; icon: typeof CheckCircle2 }
> = {
  idle: { label: "Idle", variant: "secondary", icon: CircleDashed },
  launching: { label: "Launching", variant: "default", icon: Loader2 },
  loading: { label: "Loading", variant: "default", icon: Loader2 },
  waiting: { label: "Waiting", variant: "secondary", icon: CircleDashed },
  executing: { label: "Executing", variant: "default", icon: Loader2 },
  recovering: { label: "Recovering", variant: "warning", icon: RefreshCcw },
  completed: { label: "Completed", variant: "success", icon: CheckCircle2 },
  failed: { label: "Failed", variant: "destructive", icon: XCircle },
  cancelled: { label: "Cancelled", variant: "secondary", icon: OctagonX },
};

const SPINNING_STATES: BrowserTaskRunState[] = ["launching", "loading", "executing", "recovering"];

export function BrowserTaskBadge({ state }: { state: BrowserTaskRunState }) {
  const config = STATUS_CONFIG[state];
  const Icon = config.icon;
  return (
    <Badge variant={config.variant}>
      <Icon className={SPINNING_STATES.includes(state) ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
      {config.label}
    </Badge>
  );
}
