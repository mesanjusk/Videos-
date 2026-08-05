import { requireUserId } from "@/core/auth/session";
import { listCharacterLibrary } from "@/modules/characters/service";
import { HelpButton } from "@/components/shared/help-button";
import { ProjectWizard, type WizardLibraryCharacter } from "./project-wizard";

export default async function NewProjectPage() {
  const userId = await requireUserId();
  const characters = await listCharacterLibrary(userId);

  const libraryCharacters: WizardLibraryCharacter[] = characters.map((c) => {
    const cover = (c.sheetAssets ?? []).find((s) => s.pose === "front-view" && s.assetId && typeof s.assetId === "object");
    return {
      id: c._id.toString(),
      name: c.name,
      role: c.role ?? undefined,
      coverUrl: cover ? ((cover.assetId as unknown as { url: string }).url) : null,
    };
  });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Create a project</h1>
            <HelpButton text="A few quick steps: basics, style, your story idea, an optional cast from your Character Library, then generate. Nothing here requires writing a prompt — just describe your idea in plain words." />
          </div>
          <p className="text-sm text-muted-foreground">A few quick questions, then we take it from here.</p>
        </div>
      </div>
      <ProjectWizard libraryCharacters={libraryCharacters} />
    </div>
  );
}
