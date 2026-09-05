import Link from "next/link";
import { Plus } from "lucide-react";
import { requireUserId } from "@/core/auth/session";
import { listProjects, nextActionForStatus } from "@/modules/projects/service";
import { Asset } from "@/modules/assets/models/Asset";
import { Button } from "@/components/ui/button";
import { ProjectsList } from "./projects-list";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const userId = await requireUserId();
  const projects = await listProjects(userId);

  // One query for every finished video and thumbnail on the page, rather than two per card — the
  // shelf renders the media itself now, and a per-card lookup would be N+1 on a list that grows
  // with every video someone makes.
  const assetIds = projects.flatMap((p) => [p.finalVideoAssetId, p.thumbnailAssetId].filter(Boolean));
  const assets = assetIds.length
    ? await Asset.find({ _id: { $in: assetIds }, userId }).select("url").lean()
    : [];
  const urlById = new Map(assets.map((a) => [a._id.toString(), a.url as string]));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">My videos</h1>
        <Button asChild>
          <Link href="/create">
            <Plus className="h-4 w-4" />
            New
          </Link>
        </Button>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center gap-5 py-24 text-center">
          <p className="text-5xl" aria-hidden>
            🎬
          </p>
          <p className="text-muted-foreground">Nothing here yet.</p>
          <Button asChild size="lg" className="h-14 px-8 text-base">
            <Link href="/create">Make your first video</Link>
          </Button>
        </div>
      ) : (
        <ProjectsList
          projects={projects.map((project) => {
            const next = nextActionForStatus(project.status ?? "draft");
            const id = project._id.toString();
            return {
              id,
              title: project.storyJson?.title || project.title,
              style: project.style,
              targetPlatform: project.targetPlatform,
              durationSeconds: project.durationSeconds,
              language: project.language,
              completionPercent: project.completionPercent ?? 0,
              nextActionLabel: next.label,
              nextActionHref: next.href(id),
              videoUrl: project.finalVideoAssetId ? (urlById.get(project.finalVideoAssetId.toString()) ?? null) : null,
              thumbnailUrl: project.thumbnailAssetId ? (urlById.get(project.thumbnailAssetId.toString()) ?? null) : null,
            };
          })}
        />
      )}
    </div>
  );
}
