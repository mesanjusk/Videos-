import Link from "next/link";
import { Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/shared/empty-state";
import type { ProductionRunStage } from "@/modules/production-runs/models/ProductionRun";

export interface PipelineRunItem {
  id: string;
  projectId: string;
  projectTitle: string;
  completionPercent: number;
  profileName: string;
  topic: string;
  stage: ProductionRunStage;
  startedAt: string;
  completedAt: string | null;
  executionTimeSeconds: number | null;
  retryCount: number;
  failedSceneCount: number;
}

const STAGE_LABELS: Record<ProductionRunStage, { label: string; variant: "default" | "secondary" | "success" | "warning" | "destructive" }> = {
  planning: { label: "Planning", variant: "secondary" },
  ready: { label: "Ready", variant: "secondary" },
  generating: { label: "Generating", variant: "default" },
  rendering: { label: "Rendering", variant: "default" },
  downloading: { label: "Downloading", variant: "default" },
  quality_check: { label: "Needs you", variant: "warning" },
  retry: { label: "Retrying", variant: "warning" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
};

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "In progress";
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remaining}s` : `${remaining}s`;
}

export function PipelineMonitor({ runs }: { runs: PipelineRunItem[] }) {
  if (runs.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No production runs yet"
        description="Generate a project from a Production Profile and its progress will show up here."
      />
    );
  }

  return (
    <div className="space-y-3">
      {runs.map((run) => {
        const stageInfo = STAGE_LABELS[run.stage];
        return (
          <Card key={run.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/projects/${run.projectId}`} className="truncate font-medium hover:underline">
                    {run.projectTitle}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {run.profileName} · &ldquo;{run.topic}&rdquo;
                  </p>
                </div>
                <Badge variant={stageInfo.variant}>{stageInfo.label}</Badge>
              </div>

              <Progress value={run.completionPercent} className="h-1.5" />

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Started {new Date(run.startedAt).toLocaleString()}</span>
                <span>Duration: {formatDuration(run.executionTimeSeconds)}</span>
                {run.retryCount > 0 && <span>{run.retryCount} retries</span>}
                {run.failedSceneCount > 0 && <span className="text-destructive">{run.failedSceneCount} failed scenes</span>}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
