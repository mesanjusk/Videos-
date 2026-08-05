import { requireUserId } from "@/core/auth/session";
import { listProductionProfiles } from "@/modules/production-profiles/service";
import { listCharacterLibrary } from "@/modules/characters/service";
import { listStylePacks } from "@/modules/style-packs/service";
import { listVoicePacks } from "@/modules/voice-packs/service";
import { listTemplatesForUser } from "@/modules/prompt-templates/service";
import { HelpButton } from "@/components/shared/help-button";
import {
  ProductionProfilesManager,
  type ProductionProfileItem,
  type PickerCharacter,
  type PickerPack,
  type PickerTemplate,
} from "./production-profiles-manager";

export default async function ProductionProfilesPage() {
  const userId = await requireUserId();
  const [profiles, characters, stylePacks, voicePacks, templates] = await Promise.all([
    listProductionProfiles(userId),
    listCharacterLibrary(userId),
    listStylePacks(userId),
    listVoicePacks(userId),
    listTemplatesForUser(userId),
  ]);

  const items: ProductionProfileItem[] = profiles.map((p) => ({
    id: p._id.toString(),
    name: p.name,
    description: p.description ?? undefined,
    category: p.category ?? undefined,
    version: p.version ?? 1,
    status: p.status ?? "draft",
    language: p.language ?? "en",
    aspectRatio: p.aspectRatio ?? "9:16",
    resolution: { width: p.resolution?.width ?? 1080, height: p.resolution?.height ?? 1920 },
    fps: p.fps ?? 30,
    sceneDurationSeconds: p.sceneDurationSeconds ?? 8,
    defaultSceneCount: p.defaultSceneCount ?? 8,
    characterIds: (p.characterIds ?? []).map((c) => c.toString()),
    stylePackId: p.stylePackId?.toString(),
    voicePackId: p.voicePackId?.toString(),
    promptTemplateIds: (p.promptTemplateIds ?? []).map((t) => t.toString()),
    quality: {
      minResolutionWidth: p.quality?.minResolutionWidth ?? 1080,
      minResolutionHeight: p.quality?.minResolutionHeight ?? 1350,
      minSceneDurationSeconds: p.quality?.minSceneDurationSeconds ?? 5,
      maxSceneDurationSeconds: p.quality?.maxSceneDurationSeconds ?? 8,
      characterConsistencyThreshold: p.quality?.characterConsistencyThreshold ?? 0.45,
      retryStrategy: p.quality?.retryStrategy ?? "quality-triggered",
    },
    render: {
      oneSceneAtATime: p.render?.oneSceneAtATime ?? true,
      maxParallelJobs: p.render?.maxParallelJobs ?? 2,
      providerOverrides: {
        story: p.render?.providerOverrides?.story ?? undefined,
        image: p.render?.providerOverrides?.image ?? undefined,
        video: p.render?.providerOverrides?.video ?? undefined,
        voice: p.render?.providerOverrides?.voice ?? undefined,
        lipsync: p.render?.providerOverrides?.lipsync ?? undefined,
      },
      retryDelaySeconds: p.render?.retryDelaySeconds ?? 30,
      automaticContinuation: p.render?.automaticContinuation ?? true,
      recoveryStrategy: p.render?.recoveryStrategy ?? "manual-handoff",
    },
  }));

  const characterOptions: PickerCharacter[] = characters.map((c) => ({ id: c._id.toString(), name: c.name }));
  const stylePackOptions: PickerPack[] = stylePacks.map((s) => ({ id: s._id.toString(), name: s.name }));
  const voicePackOptions: PickerPack[] = voicePacks.map((v) => ({ id: v._id.toString(), name: v.name }));
  const templateOptions: PickerTemplate[] = templates.map((t) => ({
    id: t._id.toString(),
    scope: t.scope,
    name: t.name,
    isDefault: t.isDefault ?? false,
  }));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Production Profiles</h1>
        <HelpButton text="A Production Profile bundles an entire pipeline — cast, style, voice, prompt presets, quality thresholds, render preferences — so a new project needs only a topic. Nothing here duplicates your characters or prompts; a profile just references what already exists." />
      </div>
      <p className="text-sm text-muted-foreground">
        Enter a topic, pick a profile, click Generate — everything else (cast, style, prompts, pipeline) is already configured.
      </p>
      <ProductionProfilesManager
        profiles={items}
        characters={characterOptions}
        stylePacks={stylePackOptions}
        voicePacks={voicePackOptions}
        templates={templateOptions}
      />
    </div>
  );
}
