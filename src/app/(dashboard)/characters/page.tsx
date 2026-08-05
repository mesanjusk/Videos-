import { requireUserId } from "@/core/auth/session";
import { listCharacterLibrary } from "@/modules/characters/service";
import { listProjects } from "@/modules/projects/service";
import { HelpButton } from "@/components/shared/help-button";
import { CharacterLibraryManager, type LibraryCharacter, type LibraryProjectOption } from "./character-library-manager";

export default async function CharacterLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ target?: string }>;
}) {
  const userId = await requireUserId();
  const { target } = await searchParams;

  const [characters, projects] = await Promise.all([listCharacterLibrary(userId), listProjects(userId)]);

  const items: LibraryCharacter[] = characters.map((c) => {
    const homeProject = c.projectId as unknown as { _id: string; title?: string } | undefined;
    const usedIn = (c.usedInProjectIds ?? []) as unknown as { _id: string; title?: string }[];
    const projectCount = new Set([homeProject?._id, ...usedIn.map((p) => p._id)].filter(Boolean)).size;
    const cover = (c.sheetAssets ?? []).find((s) => s.pose === "front-view" && s.assetId && typeof s.assetId === "object");

    return {
      id: c._id.toString(),
      name: c.name,
      role: c.role ?? undefined,
      spec: {
        age: c.spec?.age ?? undefined,
        bodyType: c.spec?.bodyType ?? undefined,
        face: c.spec?.face ?? undefined,
        eyes: c.spec?.eyes ?? undefined,
        hair: c.spec?.hair ?? undefined,
        clothes: c.spec?.clothes ?? undefined,
        shoes: c.spec?.shoes ?? undefined,
        accessories: c.spec?.accessories ?? undefined,
        personality: c.spec?.personality ?? undefined,
      },
      masterPrompt: c.masterPrompt ?? undefined,
      animationStyle: c.animationStyle ?? undefined,
      colorPalette: c.colorPalette ?? [],
      voiceProfile: c.voiceProfile
        ? { gender: c.voiceProfile.gender ?? undefined, age: c.voiceProfile.age ?? undefined, tone: c.voiceProfile.tone ?? undefined }
        : undefined,
      version: c.version ?? 1,
      versionCount: (c.previousVersions ?? []).length + 1,
      projectCount,
      hasHomeProject: !!c.projectId,
      sheetPoses: (c.sheetAssets ?? []).map((s) => s.pose),
      coverUrl: cover ? ((cover.assetId as unknown as { url: string }).url) : null,
    };
  });

  const projectOptions: LibraryProjectOption[] = projects.map((p) => ({ id: p._id.toString(), title: p.title }));

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Character Library</h1>
        <HelpButton text="Every character is permanent — create it once, keep refining its master prompt, expressions, voice, and style, and reuse the exact same character in as many projects as you want. No more recreating a character from scratch for a new episode." />
      </div>
      <p className="text-sm text-muted-foreground">
        Your permanent cast. Assigning a character to a project links it in — it stays the same character everywhere,
        so an edit here applies to every project that uses it.
      </p>
      <CharacterLibraryManager characters={items} projects={projectOptions} targetProjectId={target ?? null} />
    </div>
  );
}
