import { requireUserId } from "@/core/auth/session";
import { countJobsByStatus, listAllJobsForUser } from "@/modules/jobs/service";
import type { JobStatus } from "@/modules/jobs/models/Job";
import { HelpButton } from "@/components/shared/help-button";
import { QueueManager, type QueueJobItem } from "./queue-manager";

const STATUS_CHIPS: { status: JobStatus | "all"; label: string }[] = [
  { status: "all", label: "All" },
  { status: "queued", label: "Waiting" },
  { status: "running", label: "Running" },
  { status: "retrying", label: "Retrying" },
  { status: "manual_pending", label: "Needs you" },
  { status: "completed", label: "Completed" },
  { status: "failed", label: "Failed" },
  { status: "cancelled", label: "Cancelled" },
];

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const userId = await requireUserId();
  const { status: rawStatus } = await searchParams;
  const status = STATUS_CHIPS.some((c) => c.status === rawStatus) && rawStatus !== "all" ? (rawStatus as JobStatus) : undefined;

  const [counts, jobs] = await Promise.all([countJobsByStatus(userId), listAllJobsForUser(userId, status)]);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  const items: QueueJobItem[] = jobs.map((job) => ({
    id: job._id.toString(),
    type: job.type,
    status: job.status,
    attempts: job.attempts ?? 0,
    error: job.error ?? undefined,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    projectId: (job.projectId as unknown as { _id: string })?._id?.toString?.() ?? String(job.projectId),
    projectTitle: (job.projectId as unknown as { title?: string })?.title ?? "Untitled project",
    characterName: job.characterId && typeof job.characterId === "object" ? (job.characterId as { name?: string }).name : undefined,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
        <HelpButton text="Every generation job across every project, in one place — the production queue behind the whole studio. Jobs persist here through a refresh; a job that fails once but has attempts left shows as Retrying, not stuck on Running." />
      </div>
      <p className="text-sm text-muted-foreground">{total} job{total === 1 ? "" : "s"} total.</p>

      <div className="flex flex-wrap gap-2">
        {STATUS_CHIPS.map((chip) => {
          const count = chip.status === "all" ? total : counts[chip.status];
          const isActive = chip.status === "all" ? !status : status === chip.status;
          return (
            <a
              key={chip.status}
              href={chip.status === "all" ? "/queue" : `/queue?status=${chip.status}`}
              className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                isActive ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {chip.label} ({count})
            </a>
          );
        })}
      </div>

      <QueueManager jobs={items} />
    </div>
  );
}
