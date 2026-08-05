import { notFound } from "next/navigation";
import { requireUserId } from "@/core/auth/session";
import { getProject } from "@/modules/projects/service";
import { listScenes } from "@/modules/scenes/service";
import { listCharacters } from "@/modules/characters/service";
import { listBackgrounds } from "@/modules/backgrounds/service";
import { findAccountWithFlowSession } from "@/modules/accounts/service";
import { HelpButton } from "@/components/shared/help-button";
import { ScenesManager, type SceneListItem } from "./scenes-manager";

export default async function ScenesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireUserId();
  const { projectId } = await params;
  const project = await getProject(userId, projectId);
  if (!project) notFound();

  const [scenes, characters, backgrounds, flowAccount] = await Promise.all([
    listScenes(userId, projectId),
    listCharacters(userId, projectId),
    listBackgrounds(userId, projectId),
    findAccountWithFlowSession(userId),
  ]);

  const sceneItems: SceneListItem[] = scenes.map((s) => ({
    id: s._id.toString(),
    index: s.index,
    visual: s.visual,
    dialogue: s.dialogue ?? "",
    camera: s.camera ?? "",
    emotion: s.emotion ?? "",
    status: s.status ?? "pending",
    characterIds: (s.characterIds ?? []).map((c) => (typeof c === "object" ? (c as unknown as { _id: string })._id.toString() : String(c))),
    backgroundId: s.backgroundId ? (typeof s.backgroundId === "object" ? (s.backgroundId as unknown as { _id: string })._id.toString() : String(s.backgroundId)) : null,
    imageUrl: s.imageAssetId && typeof s.imageAssetId === "object" ? (s.imageAssetId as unknown as { url: string }).url : null,
    videoUrl: s.videoAssetId && typeof s.videoAssetId === "object" ? (s.videoAssetId as unknown as { url: string }).url : null,
    voiceUrl: s.voiceAssetId && typeof s.voiceAssetId === "object" ? (s.voiceAssetId as unknown as { url: string }).url : null,
    lipSyncUrl: s.lipSyncAssetId && typeof s.lipSyncAssetId === "object" ? (s.lipSyncAssetId as unknown as { url: string }).url : null,
    videoTaskId: s.videoTaskId ?? null,
    lipSyncTaskId: s.lipSyncTaskId ?? null,
    pendingVideoPrompt: s.pendingVideoPrompt ?? null,
    pendingVideoInstructions: s.pendingVideoInstructions ?? null,
    pendingLipSyncInstructions: s.pendingLipSyncInstructions ?? null,
    imageStale: s.imageStale ?? false,
    videoStale: s.videoStale ?? false,
    voiceStale: s.voiceStale ?? false,
    lipSyncStale: s.lipSyncStale ?? false,
  }));

  const characterOptions = characters.map((c) => ({
    id: c._id.toString(),
    name: c.name,
    coverUrl: c.sheetAssets?.find((a) => a.pose === "front-view")?.assetId
      ? ((c.sheetAssets.find((a) => a.pose === "front-view")!.assetId as unknown as { url: string }).url)
      : null,
  }));
  const backgroundOptions = backgrounds.map((b) => ({ id: b._id.toString(), name: b.name }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Scenes</h1>
        <HelpButton text="Assign characters and a background to each scene, then generate its image and video. Video is generated with Google Flow — we prepare everything and hand you a ready-to-paste prompt." />
      </div>
      <p className="text-sm text-muted-foreground">{sceneItems.length} scenes from your story.</p>
      <ScenesManager
        projectId={projectId}
        initialScenes={sceneItems}
        characterOptions={characterOptions}
        backgroundOptions={backgroundOptions}
        hasFlowSession={!!flowAccount}
      />
    </div>
  );
}
