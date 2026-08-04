import type { Job as BullJob } from "bullmq";
import { withJobLifecycle, type BullJobData, type ProcessorResult } from "./helpers";
import { Project } from "@/modules/projects/models/Project";
import { Scene } from "@/modules/scenes/models/Scene";
import { Character } from "@/modules/characters/models/Character";
import { Background } from "@/modules/backgrounds/models/Background";
import { Asset } from "@/modules/assets/models/Asset";
import { resolveGenerationAccount } from "@/modules/accounts/service";
import { recordAccountUsage } from "@/modules/accounts/selector";
import { getImageProvider } from "@/core/ai/registry";
import { uploadImageAsset } from "@/core/storage/cloudinary";
import { resolveActiveTemplate } from "@/modules/prompt-templates/service";
import { getProviderOverride } from "@/modules/settings/service";

/** PDF Step 4 — Scene Prompt Formula: character reference + background + action + camera + emotion + lighting + style. */
export async function processSceneImageJob(bullJob: BullJob<BullJobData>): Promise<ProcessorResult> {
  return withJobLifecycle(bullJob, async (jobDoc) => {
    if (!jobDoc.sceneId) throw new Error("Job is missing sceneId");
    const [scene, project] = await Promise.all([
      Scene.findOne({ _id: jobDoc.sceneId, userId: jobDoc.userId }),
      Project.findOne({ _id: jobDoc.projectId, userId: jobDoc.userId }),
    ]);
    if (!scene) throw new Error("Scene not found");
    if (!project) throw new Error("Project not found");

    const [characters, background] = await Promise.all([
      Character.find({ _id: { $in: scene.characterIds }, userId: jobDoc.userId }).lean(),
      scene.backgroundId ? Background.findOne({ _id: scene.backgroundId, userId: jobDoc.userId }).populate("assetId").lean() : null,
    ]);

    const characterReferenceImages = characters
      .map((c) => {
        const front = c.sheetAssets?.find((s) => s.pose === "front-view");
        return front ? { url: (front.assetId as unknown as { url: string })?.url, description: c.name } : null;
      })
      .filter((r): r is { url: string; description: string } => !!r?.url);

    const backgroundAsset = background?.assetId as unknown as { url: string } | undefined;

    const { accountId, context } = await resolveGenerationAccount(jobDoc.userId);
    jobDoc.set("googleAccountId", accountId);
    await jobDoc.save();

    const providerId = await getProviderOverride(jobDoc.userId, "image");
    const provider = getImageProvider(providerId);
    const style = project.style === "Custom" ? (project.customStyleDescription ?? "Custom") : project.style;
    const templateOverride = await resolveActiveTemplate(jobDoc.userId, "scene_image");

    const image = await provider.generateSceneImage(
      {
        characterReferenceImages,
        backgroundReferenceUrl: backgroundAsset?.url,
        action: scene.visual,
        cameraAngle: scene.camera,
        emotion: scene.emotion,
        lighting: background?.lighting ?? "morning",
        style,
        aspectRatio: "4:5",
        templateOverride,
      },
      context,
    );
    await recordAccountUsage(accountId);

    const uploaded = await uploadImageAsset(image.data, {
      folder: `projects/${jobDoc.projectId}/scenes/${scene._id.toString()}`,
      publicId: "image",
    });
    const asset = await Asset.create({
      userId: jobDoc.userId,
      projectId: jobDoc.projectId,
      kind: "image",
      cloudinaryPublicId: uploaded.publicId,
      url: uploaded.url,
      width: uploaded.width,
      height: uploaded.height,
      bytes: uploaded.bytes,
    });

    scene.set("imageAssetId", asset._id);
    scene.status = "image_ready";
    await scene.save();

    return { assetId: asset._id.toString() };
  });
}
