import { notFound } from "next/navigation";
import { requireUserId } from "@/core/auth/session";
import { getProject } from "@/modules/projects/service";
import { listBackgrounds } from "@/modules/backgrounds/service";
import { HelpButton } from "@/components/shared/help-button";
import { BackgroundsManager, type BackgroundListItem } from "./backgrounds-manager";

export default async function BackgroundsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireUserId();
  const { projectId } = await params;
  const project = await getProject(userId, projectId);
  if (!project) notFound();

  const backgrounds = await listBackgrounds(userId, projectId);

  const items: BackgroundListItem[] = backgrounds.map((b) => ({
    id: b._id.toString(),
    name: b.name,
    category: b.category,
    description: b.description,
    url: b.assetId && typeof b.assetId === "object" ? (b.assetId as unknown as { url: string }).url : null,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Backgrounds</h1>
        <HelpButton text="Create the settings for your scenes once — indoor, outdoor, forest, city, and more. We keep the same visual style across every background so scenes feel consistent." />
      </div>
      <p className="text-sm text-muted-foreground">Add every location your story needs.</p>
      <BackgroundsManager projectId={projectId} initialBackgrounds={items} />
    </div>
  );
}
