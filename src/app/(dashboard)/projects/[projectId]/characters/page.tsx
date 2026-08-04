import { notFound } from "next/navigation";
import { requireUserId } from "@/core/auth/session";
import { getProject } from "@/modules/projects/service";
import { listCharacters } from "@/modules/characters/service";
import { HelpButton } from "@/components/shared/help-button";
import { CharactersManager, type CharacterListItem } from "./characters-manager";

export default async function CharactersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireUserId();
  const { projectId } = await params;
  const project = await getProject(userId, projectId);
  if (!project) notFound();

  const characters = await listCharacters(userId, projectId);

  const items: CharacterListItem[] = characters.map((c) => ({
    id: c._id.toString(),
    name: c.name,
    role: c.role ?? undefined,
    personality: c.spec?.personality ?? undefined,
    sheetAssets: (c.sheetAssets ?? [])
      .filter((s) => s.assetId && typeof s.assetId === "object")
      .map((s) => ({
        pose: s.pose,
        url: (s.assetId as unknown as { url: string }).url,
      })),
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Characters</h1>
        <HelpButton text="Create each character once. We generate a turnaround sheet (multiple poses and expressions) that gets reused in every scene, so they look the same throughout your video." />
      </div>
      <p className="text-sm text-muted-foreground">
        {project.storyJson?.characters?.length
          ? `Your story suggested: ${project.storyJson.characters.map((c) => c.name).join(", ")}.`
          : "Add the characters from your story."}
      </p>
      <CharactersManager projectId={projectId} initialCharacters={items} />
    </div>
  );
}
