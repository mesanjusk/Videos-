"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export interface ProjectListItem {
  id: string;
  title: string;
  style: string;
  targetPlatform: string;
  durationSeconds: number;
  language: string;
  completionPercent: number;
  nextActionLabel: string;
  nextActionHref: string;
}

export function ProjectsList({ projects }: { projects: ProjectListItem[] }) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function deleteProject(id: string, title: string) {
    if (!window.confirm(`Delete "${title}"? This can't be undone — all its characters, backgrounds, scenes, and generated media will be removed.`)) {
      return;
    }
    setDeletingId(id);
    await fetch(`/api/projects/${id}`, { method: "DELETE" }).catch(() => {});
    setDeletingId(null);
    router.refresh();
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <Card key={project.id} className="relative">
          <Link href={`/projects/${project.id}`} className="absolute inset-0 z-0" aria-label={`Open ${project.title}`} />
          <CardContent className="flex flex-col gap-3 p-5">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium leading-tight">{project.title}</p>
              <div className="z-10 flex items-center gap-1">
                <Badge variant="outline">{project.style}</Badge>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label="Project actions">
                      <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      className="text-destructive"
                      disabled={deletingId === project.id}
                      onSelect={() => deleteProject(project.id, project.title)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete project
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {project.targetPlatform} · {project.durationSeconds}s · {project.language}
            </p>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Progress</span>
                <span>{project.completionPercent}%</span>
              </div>
              <Progress value={project.completionPercent} />
            </div>
            <Button asChild size="sm" className="z-10 mt-1 w-full">
              <Link href={project.nextActionHref}>{project.nextActionLabel}</Link>
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
