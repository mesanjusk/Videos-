import { requireUserId } from "@/core/auth/session";
import { listTemplatesForUser } from "@/modules/prompt-templates/service";
import { HelpButton } from "@/components/shared/help-button";
import { PromptLibrary, type PromptTemplateItem } from "./prompt-library";

const SCOPE_LABELS: Record<string, { label: string; description: string }> = {
  story: { label: "Story", description: "Used to turn your idea (or pasted script) into an 8-scene script." },
  character: { label: "Character sheet", description: "Used to generate each character's turnaround sheet." },
  background: { label: "Background", description: "Used to generate each background image." },
  scene_image: { label: "Scene image", description: "Used to generate each scene's still image." },
  scene_video: { label: "Scene video", description: "The prompt handed to you for Google Flow's manual step." },
  voice: { label: "Voice", description: "Used to generate each scene's spoken dialogue." },
  thumbnail: { label: "Thumbnail", description: "Used to generate your video's thumbnail image." },
};

export default async function PromptsPage() {
  const userId = await requireUserId();
  const templates = await listTemplatesForUser(userId);

  const items: PromptTemplateItem[] = templates.map((t) => ({
    id: t._id.toString(),
    scope: t.scope,
    label: SCOPE_LABELS[t.scope]?.label ?? t.scope,
    description: SCOPE_LABELS[t.scope]?.description ?? "",
    template: t.template,
    variables: t.variables ?? [],
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Prompt library</h1>
        <HelpButton text="These are the exact instructions sent to the AI for each generation step. Edit them to change tone, style, or detail — every new generation uses your edited version. Reset brings back the original." />
      </div>
      <p className="text-sm text-muted-foreground">
        Advanced — most people never need to touch these. Editing a template changes it for every future
        generation of that type, across all your projects.
      </p>
      <PromptLibrary items={items} />
    </div>
  );
}
