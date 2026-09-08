import type { Job as BullJob } from "bullmq";
import { withJobLifecycle, type BullJobData, type ProcessorResult } from "./helpers";
import { Project } from "@/modules/projects/models/Project";
import { Character } from "@/modules/characters/models/Character";
import { Asset } from "@/modules/assets/models/Asset";
import { resolveGenerationAccountOrEnvKey } from "@/modules/accounts/service";
import { recordAccountUsage } from "@/modules/accounts/selector";
import { getImageProvider } from "@/core/ai/registry";
import { uploadImageAsset } from "@/core/storage/cloudinary";
import { resolveActiveTemplate } from "@/modules/prompt-templates/service";
import { getProviderOverride } from "@/modules/settings/service";
import { checkImageResolution } from "@/core/quality/checks";
import { QualityCheckFailedError } from "@/core/quality/errors";
import { resolveQualityTargets } from "@/core/production-engine/resolve-quality-targets";
import { routeSingleImage } from "@/core/production/image-route";
import { thumbnailPrompt, thumbnailReferences } from "@/core/ai/providers/image-prompts";

/** PDF Step 10 — Thumbnail. */
export async function processThumbnailJob(bullJob: BullJob<BullJobData>): Promise<ProcessorResult> {
  return withJobLifecycle(bullJob, async (jobDoc) => {
    const project = await Project.findOne({ _id: jobDoc.projectId, userId: jobDoc.userId });
    if (!project) throw new Error("Project not found");

    // Includes characters reused from the library (usedInProjectIds), not just ones created
    // directly in this project — a reused character must show up everywhere it's assigned.
    const characters = await Character.find({
      userId: jobDoc.userId,
      $or: [{ projectId: jobDoc.projectId }, { usedInProjectIds: jobDoc.projectId }],
    }).lean();
    const characterReferenceImages = characters
      .map((c) => {
        const front = c.sheetAssets?.find((s) => s.pose === "front-view");
        return front ? { url: (front.assetId as unknown as { url: string })?.url, description: c.name } : null;
      })
      .filter((r): r is { url: string; description: string } => !!r?.url);

    // Null when no pooled account is available but GEMINI_API_KEY is — the providers take an
    // optional context and fall back to that key themselves.
    const account = await resolveGenerationAccountOrEnvKey(jobDoc.userId);
    const context = account?.context;
    if (account) jobDoc.set("googleAccountId", account.accountId);
    await jobDoc.save();

    const providerId = await getProviderOverride(jobDoc.userId, "image");
    const style = project.style === "Custom" ? (project.customStyleDescription ?? "Custom") : project.style;
    const title = project.storyJson?.title ?? project.title;
    const promptTemplateOverrides = project.promptTemplateOverrides as Record<string, string> | undefined;
    const templateOverride = await resolveActiveTemplate(jobDoc.userId, "thumbnail", promptTemplateOverrides?.thumbnail);

    const input = {
      title,
      characterReferenceImages,
      style,
      description: project.premise ?? undefined,
      templateOverride,
    };

    const image = await routeSingleImage(jobDoc, {
      preferredProviderId: providerId,
      prompt: thumbnailPrompt(input),
      referenceUrls: thumbnailReferences(input),
      viaApi: (provider) => provider.generateThumbnail(input, context),
      flow: {
        projectId: jobDoc.projectId?.toString(),
        aspectRatio: "9:16",
        imageTarget: { kind: "thumbnail", projectId: jobDoc.projectId?.toString() },
      },
    });
    if (account) await recordAccountUsage(account.accountId);

    const uploaded = await uploadImageAsset(image.data, {
      folder: `projects/${jobDoc.projectId}`,
      publicId: "thumbnail",
    });
    const qualityTargets = await resolveQualityTargets(project.activeProfileId, jobDoc.userId);
    const resolutionIssues = checkImageResolution(uploaded, qualityTargets.imageTarget);
    if (resolutionIssues.length > 0) throw new QualityCheckFailedError(resolutionIssues);

    const asset = await Asset.create({
      userId: jobDoc.userId,
      projectId: jobDoc.projectId,
      kind: "thumbnail",
      cloudinaryPublicId: uploaded.publicId,
      url: uploaded.url,
      width: uploaded.width,
      height: uploaded.height,
      bytes: uploaded.bytes,
    });

    const description = project.premise?.slice(0, 200) ?? `A ${style.toLowerCase()} cartoon adventure.`;
    const tags = [
      ...new Set([
        style.toLowerCase(),
        "cartoon",
        "kids",
        project.targetPlatform,
        project.language,
        ...characters.map((c) => c.name.toLowerCase()),
      ]),
    ].slice(0, 15);

    project.set("thumbnailAssetId", asset._id);
    project.set("thumbnailTitle", title);
    project.set("thumbnailDescription", description);
    project.set("thumbnailTags", tags);
    await project.save();

    return { assetId: asset._id.toString(), title, description, tags };
  });
}
