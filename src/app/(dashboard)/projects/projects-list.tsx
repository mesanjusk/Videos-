"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, MoreVertical, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  /** Set once the render finishes — this is what turns a row into something you can watch. */
  videoUrl: string | null;
  thumbnailUrl: string | null;
}

/**
 * A shelf of videos, not a table of projects.
 *
 * Each card used to carry a style badge, a platform, a duration, a language, a percentage, a
 * progress bar and a button labelled with the next pipeline step ("Plan scenes", "Generate video &
 * voice"). None of that is what someone is looking for when they come back the next day — they are
 * looking for the video they made, to watch it or to send it to someone. So a finished project
 * leads with its thumbnail and a download button, and an unfinished one shows how far along it is
 * and nothing else.
 */
export function ProjectsList({ projects }: { projects: ProjectListItem[] }) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function deleteProject(id: string, title: string) {
    if (!window.confirm(`Delete "${title}"? This also removes its characters, backgrounds, scenes and generated media.`)) {
      return;
    }
    setDeletingId(id);
    await fetch(`/api/projects/${id}`, { method: "DELETE" }).catch(() => {});
    setDeletingId(null);
    router.refresh();
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => (
        <div key={project.id} className="group relative">
          <Link
            href={`/projects/${project.id}`}
            className="block overflow-hidden rounded-2xl border border-border bg-card transition-shadow hover:shadow-lg"
          >
            <div className="relative aspect-video w-full overflow-hidden bg-muted">
              {project.thumbnailUrl ? (
                // Plain <img>, not next/image: the storage provider is swappable per deployment
                // (Cloudinary or local disk, see core/storage), so there is no fixed remote host
                // allowlist to configure next/image against.
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={project.thumbnailUrl}
                  alt=""
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <span className="text-3xl opacity-40" aria-hidden>
                    🎬
                  </span>
                </div>
              )}

              {project.videoUrl ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
                  <Play className="h-10 w-10 fill-white text-white drop-shadow" />
                </div>
              ) : (
                // An unfinished project says so with one line at the bottom of its own card, rather
                // than a labelled progress widget that repeats the number three ways.
                <div className="absolute inset-x-0 bottom-0 h-1 bg-black/10">
                  <div className="h-full bg-primary" style={{ width: `${project.completionPercent}%` }} />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 p-4">
              <p className="truncate font-medium leading-tight">{project.title}</p>
              {!project.videoUrl && (
                <span className="shrink-0 text-xs text-muted-foreground">{project.completionPercent}%</span>
              )}
            </div>
          </Link>

          <div className="absolute right-2 top-2 flex items-center gap-1">
            {project.videoUrl && (
              <Button asChild size="icon" variant="secondary" className="h-8 w-8 shadow-sm" aria-label={`Download ${project.title}`}>
                <a href={project.videoUrl} download onClick={(e) => e.stopPropagation()}>
                  <Download className="h-4 w-4" />
                </a>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" className="h-8 w-8 shadow-sm" aria-label={`Actions for ${project.title}`}>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive"
                  disabled={deletingId === project.id}
                  onSelect={() => deleteProject(project.id, project.title)}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ))}
    </div>
  );
}
