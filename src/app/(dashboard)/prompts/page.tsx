import { requireUserId } from "@/core/auth/session";
import { listTemplatesForUser } from "@/modules/prompt-templates/service";
import { HelpButton } from "@/components/shared/help-button";
import { PromptLibrary, type PromptScopeGroup } from "./prompt-library";

const SCOPE_LABELS: Record<string, { label: string; description: string }> = {
  story: { label: "Story", description: "Used to turn your idea (or pasted script) into an 8-scene script." },
  character: { label: "Character sheet", description: "Used to generate each character's turnaround sheet." },
  background: { label: "Background", description: "Used to generate each background image." },
  scene_image: { label: "Scene image", description: "Used to generate each scene's still image." },
  scene_video: { label: "Scene video", description: "The prompt handed to you for Google Flow's manual step." },
  voice: { label: "Voice", description: "Used to generate each scene's spoken dialogue." },
  thumbnail: { label: "Thumbnail", description: "Used to generate your video's thumbnail image." },
  music: { label: "Music", description: "A suggested prompt to paste into Suno/Udio — background music itself is a manual upload." },
};

const SCOPE_ORDER = ["story", "character", "background", "scene_image", "scene_video", "voice", "music", "thumbnail"];

export default async function PromptsPage() {
  const userId = await requireUserId();
  const templates = await listTemplatesForUser(userId);

  const groups: PromptScopeGroup[] = SCOPE_ORDER.map((scope) => {
    const presets = templates
      .filter((t) => t.scope === scope)
      .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0) || a.name.localeCompare(b.name))
      .map((t) => ({
        id: t._id.toString(),
        name: t.name,
        template: t.template,
        variables: t.variables ?? [],
        isDefault: t.isDefault ?? false,
      }));
    return {
      scope,
      label: SCOPE_LABELS[scope]?.label ?? scope,
      description: SCOPE_LABELS[scope]?.description ?? "",
      presets,
    };
  }).filter((g) => g.presets.length > 0);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Prompt library</h1>
        <HelpButton text="These are the exact instructions sent to the AI for each generation step. Save multiple named presets per step (e.g. two different character styles) and pick which one is active — every new generation uses whichever preset is active. Reset brings a preset's text back to the original." />
      </div>
      <p className="text-sm text-muted-foreground">
        Save as many named presets per step as you like — e.g. &ldquo;Hero&rdquo; and &ldquo;Villain&rdquo; character prompts
        — then activate whichever one should be used the next time that step runs, in any project.
      </p>
      <PromptLibrary groups={groups} />
    </div>
  );
}
