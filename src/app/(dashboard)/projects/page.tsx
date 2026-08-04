import Link from "next/link";
import { FolderKanban, Plus } from "lucide-react";
import { requireUserId } from "@/core/auth/session";
import { listProjects, nextActionForStatus } from "@/modules/projects/service";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { EmptyState } from "@/components/shared/empty-state";
import { HelpButton } from "@/components/shared/help-button";

export default async function ProjectsPage() {
  const userId = await requireUserId();
  const projects = await listProjects(userId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <HelpButton text="Every video you create lives here. Each card shows how far along it is and what to do next." />
        </div>
        <Button asChild>
          <Link href="/projects/new">
            <Plus className="h-4 w-4" />
            New project
          </Link>
        </Button>
      </div>

      {projects.length === 0 ? (
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const next = nextActionForStatus(project.status ?? "draft");
            return (
              <Card key={project._id.toString()}>
                <CardContent className="flex flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium leading-tight">{project.title}</p>
                    <Badge variant="outline">{project.style}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {project.targetPlatform} · {project.durationSeconds}s · {project.language}
                  </p>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Progress</span>
                      <span>{project.completionPercent ?? 0}%</span>
                    </div>
                    <Progress value={project.completionPercent ?? 0} />
                  </div>
                  <Button asChild size="sm" className="mt-1 w-full">
                    <Link href={next.href(project._id.toString())}>{next.label}</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
