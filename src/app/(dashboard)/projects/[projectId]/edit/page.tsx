import { notFound } from "next/navigation";
import { requireUserId } from "@/core/auth/session";
import { getProject } from "@/modules/projects/service";
import { Asset } from "@/modules/assets/models/Asset";
import { connectToDatabase } from "@/core/db/mongoose";
import { HelpButton } from "@/components/shared/help-button";
import { EditPanel } from "./edit-panel";

export default async function EditPage({ params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireUserId();
  const { projectId } = await params;
  const project = await getProject(userId, projectId);
  if (!project) notFound();

  await connectToDatabase();
  const [musicAsset, finalVideoAsset, thumbnailAsset] = await Promise.all([
    project.musicAssetId ? Asset.findById(project.musicAssetId).lean() : null,
    project.finalVideoAssetId ? Asset.findById(project.finalVideoAssetId).lean() : null,
    project.thumbnailAssetId ? Asset.findById(project.thumbnailAssetId).lean() : null,
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Edit & export</h1>
        <HelpButton text="Optionally add background music and a watermark, then render your final video. We join every scene, mix in voice and music, burn captions, and export at 1080x1920, 30fps." />
      </div>
      <EditPanel
        projectId={projectId}
        projectStatus={project.status ?? "draft"}
        musicUrl={musicAsset?.url ?? null}
        watermarkImageUrl={project.watermarkImageUrl ?? null}
        finalVideoUrl={finalVideoAsset?.url ?? null}
        thumbnailUrl={thumbnailAsset?.url ?? null}
        thumbnailTitle={project.thumbnailTitle ?? null}
        thumbnailDescription={project.thumbnailDescription ?? null}
        thumbnailTags={project.thumbnailTags ?? []}
      />
    </div>
  );
}
