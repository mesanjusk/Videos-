import Link from "next/link";
import { FolderKanban, Plus } from "lucide-react";
import { requireUserId } from "@/core/auth/session";
import { listProjects, nextActionForStatus } from "@/modules/projects/service";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { HelpButton } from "@/components/shared/help-button";
import { ProjectsList } from "./projects-list";

export default async function ProjectsPage() {
  const userId = await requireUserId();
  const projects = await listProjects(userId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <HelpButton text="Every video you create lives here. Click a card to open it, or use its button to jump straight to the next step. Use the ⋮ menu to delete a project." />
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
        <ProjectsList
          projects={projects.map((project) => {
            const next = nextActionForStatus(project.status ?? "draft");
            const id = project._id.toString();
            return {
              id,
              title: project.title,
              style: project.style,
              targetPlatform: project.targetPlatform,
              durationSeconds: project.durationSeconds,
              language: project.language,
              completionPercent: project.completionPercent ?? 0,
              nextActionLabel: next.label,
              nextActionHref: next.href(id),
            };
          })}
        />
      )}
    </div>
  );
}
