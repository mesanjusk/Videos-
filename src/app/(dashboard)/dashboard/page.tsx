import Link from "next/link";
import { FolderKanban, HardDrive, ListChecks, Plus, UserRound, Video, Activity, Play } from "lucide-react";
import { requireUserId } from "@/core/auth/session";
import { countProjectsByStatus, listProjects, nextActionForStatus } from "@/modules/projects/service";
import { countJobsByStatus, listRecentJobs } from "@/modules/jobs/service";
import { getStorageUsageBytes, listRecentFinalVideos } from "@/modules/assets/service";
import { listGoogleAccounts } from "@/modules/accounts/service";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { RecentActivity } from "./recent-activity";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { HelpButton } from "@/components/shared/help-button";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export default async function DashboardPage() {
  const userId = await requireUserId();
  const [projects, projectsByStatus, jobsByStatus, recentJobs, storageBytes, accounts, recentVideos] = await Promise.all([
    listProjects(userId),
    countProjectsByStatus(userId),
    countJobsByStatus(userId),
    listRecentJobs(userId, 6),
    getStorageUsageBytes(userId),
    listGoogleAccounts(userId),
    listRecentFinalVideos(userId, 6),
  ]);

  const activeJobs = jobsByStatus.queued + jobsByStatus.running + jobsByStatus.manual_pending;
  const finishedProjects = projectsByStatus.done;
  const activeAccounts = accounts.filter((a) => a.status === "active").length;
  const recentProjects = projects.slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <HelpButton text="A snapshot of every project, generation job, and connected Google account. Click 'New project' any time to start a video." />
        </div>
        <Button asChild>
          <Link href="/projects/new">
            <Plus className="h-4 w-4" />
            Create project
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={FolderKanban} label="Projects" value={projects.length} hint={`${finishedProjects} completed`} />
        <StatCard icon={Video} label="Recent videos" value={projectsByStatus.done} hint="Finished exports" />
        <StatCard icon={ListChecks} label="Current jobs" value={activeJobs} hint={`${jobsByStatus.manual_pending} need you`} />
        <StatCard icon={HardDrive} label="Storage used" value={formatBytes(storageBytes)} hint="Cloudinary free tier" />
        <StatCard icon={UserRound} label="Google accounts" value={accounts.length} hint={`${activeAccounts} active`} />
        <StatCard icon={Activity} label="Queue" value={jobsByStatus.queued} hint={`${jobsByStatus.running} running now`} />
      </div>

      {recentVideos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent videos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {recentVideos.map((video) => (
                <Link
                  key={video._id.toString()}
                  href={`/projects/${video.projectId.toString()}/edit`}
                  className="group relative aspect-[9/16] overflow-hidden rounded-lg bg-muted"
                >
                  <video src={video.url} className="h-full w-full object-cover" muted preload="metadata" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
                    <Play className="h-6 w-6 text-white opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Recent projects</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/projects">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {recentProjects.length === 0 ? (
              <EmptyState
                icon={FolderKanban}
                title="No projects yet"
                description="Start with one idea — we'll guide you through story, characters, scenes, and export."
                action={
                  <Button asChild>
                    <Link href="/projects/new">
                      <Plus className="h-4 w-4" />
                      Create your first project
                    </Link>
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {recentProjects.map((project) => {
                  const next = nextActionForStatus(project.status ?? "draft");
                  return (
                    <li key={project._id.toString()} className="flex items-center justify-between gap-4 py-3">
                      <Link href={`/projects/${project._id.toString()}`} className="min-w-0 hover:underline">
                        <p className="truncate font-medium">{project.title}</p>
                        <p className="text-xs text-muted-foreground">{project.style} · {project.targetPlatform}</p>
                        <Progress value={project.completionPercent ?? 0} className="mt-2 h-1.5 w-40" />
                      </Link>
                      <Button asChild variant="outline" size="sm" className="shrink-0">
                        <Link href={next.href(project._id.toString())}>{next.label}</Link>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            <RecentActivity jobs={recentJobs.map((job) => ({ id: job._id.toString(), type: job.type, status: job.status }))} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
