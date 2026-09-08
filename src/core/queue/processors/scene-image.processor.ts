import type { Job as BullJob } from "bullmq";
import { withJobLifecycle, type BullJobData, type ProcessorResult } from "./helpers";
import { Project } from "@/modules/projects/models/Project";
import { Scene } from "@/modules/scenes/models/Scene";
import { Character } from "@/modules/characters/models/Character";
import { Background } from "@/modules/backgrounds/models/Background";
import { Asset } from "@/modules/assets/models/Asset";
import { resolveGenerationAccountOrEnvKey } from "@/modules/accounts/service";
import { recordAccountUsage } from "@/modules/accounts/selector";
import { getImageProvider } from "@/core/ai/registry";
import { uploadImageAsset } from "@/core/storage/cloudinary";
import { resolveActiveTemplate } from "@/modules/prompt-templates/service";
import { getProviderOverride } from "@/modules/settings/service";
import { advanceScene } from "@/core/queue/orchestrator";
import { checkImageResolution } from "@/core/quality/checks";
import { QualityCheckFailedError } from "@/core/quality/errors";
import { resolveQualityTargets } from "@/core/production-engine/resolve-quality-targets";
import { isFlowImageProvider, resolveFlowImages } from "@/core/production/flow-image-step";
import { sceneImagePrompt, sceneImageReferences } from "@/core/ai/providers/image-prompts";

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

    // Null when no pooled account is available but GEMINI_API_KEY is — the providers take an
    // optional context and fall back to that key themselves.
    const account = await resolveGenerationAccountOrEnvKey(jobDoc.userId);
    const context = account?.context;
    if (account) jobDoc.set("googleAccountId", account.accountId);
    await jobDoc.save();

    const providerId = await getProviderOverride(jobDoc.userId, "image");
    // Flow is not an ImageProvider — it cannot answer synchronously — so the registry is only asked
    // for one when an API-backed provider is what will actually be used.
    const provider = isFlowImageProvider(providerId) ? null : getImageProvider(providerId);
    const style = project.style === "Custom" ? (project.customStyleDescription ?? "Custom") : project.style;
    const promptTemplateOverrides = project.promptTemplateOverrides as Record<string, string> | undefined;
    const templateOverride = await resolveActiveTemplate(jobDoc.userId, "scene_image", promptTemplateOverrides?.scene_image);

    const input = {
      characterReferenceImages,
      backgroundReferenceUrl: backgroundAsset?.url,
      action: scene.visual,
      cameraAngle: scene.camera,
      emotion: scene.emotion,
      lighting: background?.lighting ?? "morning",
      style,
      aspectRatio: "4:5" as const,
      templateOverride,
    };

    // The cast and the background go up as reference material, which is how the same faces and the
    // same place survive from one scene to the next.
    const image = isFlowImageProvider(providerId)
      ? (
          await resolveFlowImages(
            jobDoc,
            [{ key: "image", prompt: sceneImagePrompt(input), referenceUrls: sceneImageReferences(input) }],
            {
              projectId: jobDoc.projectId?.toString(),
              aspectRatio: "9:16",
              imageTarget: { kind: "scene", sceneId: scene._id.toString() },
            },
          )
        ).image!
      : await provider!.generateSceneImage(input, context);
    if (account && !isFlowImageProvider(providerId)) await recordAccountUsage(account.accountId);

    const uploaded = await uploadImageAsset(image.data, {
      folder: `projects/${jobDoc.projectId}/scenes/${scene._id.toString()}`,
      publicId: "image",
    });
    const qualityTargets = await resolveQualityTargets(project.activeProfileId, jobDoc.userId);
    const resolutionIssues = checkImageResolution(uploaded, qualityTargets.imageTarget);
    if (resolutionIssues.length > 0) throw new QualityCheckFailedError(resolutionIssues);

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
    scene.set("imageStale", false);
    scene.status = "image_ready";
    await scene.save();

    await advanceScene(jobDoc.userId, jobDoc.projectId!.toString(), scene._id.toString());

    return { assetId: asset._id.toString() };
  });
}
