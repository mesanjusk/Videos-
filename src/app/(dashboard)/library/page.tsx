import { requireUserId } from "@/core/auth/session";
import { listAllCharactersForUser } from "@/modules/characters/service";
import { listAllBackgroundsForUser } from "@/modules/backgrounds/service";
import { listProjects } from "@/modules/projects/service";
import { HelpButton } from "@/components/shared/help-button";
import { LibraryManager, type LibraryCharacterItem, type LibraryBackgroundItem, type LibraryProjectOption } from "./library-manager";

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ target?: string }>;
}) {
  const userId = await requireUserId();
  const { target } = await searchParams;

  const [characters, backgrounds, projects] = await Promise.all([
    listAllCharactersForUser(userId),
    listAllBackgroundsForUser(userId),
    listProjects(userId),
  ]);

  const characterItems: LibraryCharacterItem[] = characters.map((c) => ({
    id: c._id.toString(),
    name: c.name,
    role: c.role ?? undefined,
    sourceProjectId: (c.projectId as unknown as { _id: string })?._id?.toString?.() ?? String(c.projectId),
    sourceProjectTitle: (c.projectId as unknown as { title?: string })?.title ?? "Unknown project",
    coverUrl:
      (c.sheetAssets ?? []).find((s) => s.pose === "front-view" && s.assetId && typeof s.assetId === "object")?.assetId
        ? ((c.sheetAssets.find((s) => s.pose === "front-view")!.assetId as unknown as { url: string }).url)
        : null,
  }));

  const backgroundItems: LibraryBackgroundItem[] = backgrounds.map((b) => ({
    id: b._id.toString(),
    name: b.name,
    category: b.category,
    sourceProjectId: (b.projectId as unknown as { _id: string })?._id?.toString?.() ?? String(b.projectId),
    sourceProjectTitle: (b.projectId as unknown as { title?: string })?.title ?? "Unknown project",
    coverUrl: b.assetId && typeof b.assetId === "object" ? (b.assetId as unknown as { url: string }).url : null,
  }));

  const projectOptions: LibraryProjectOption[] = projects.map((p) => ({ id: p._id.toString(), title: p.title }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
        <HelpButton text="Every character and background you've ever generated, across all projects. Reuse them in a new project instead of regenerating from scratch — great for series and episodes that share a cast." />
      </div>
      <p className="text-sm text-muted-foreground">
        {target
          ? "Pick anything below to add it to the project you came from — no regeneration needed."
          : "Characters and backgrounds you've already generated. Add them to any project."}
      </p>
      <LibraryManager characters={characterItems} backgrounds={backgroundItems} projects={projectOptions} targetProjectId={target ?? null} />
    </div>
  );
}
