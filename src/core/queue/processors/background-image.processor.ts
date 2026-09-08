import type { Job as BullJob } from "bullmq";
import { withJobLifecycle, type BullJobData } from "./helpers";
import { Project } from "@/modules/projects/models/Project";
import { Background } from "@/modules/backgrounds/models/Background";
import { Asset } from "@/modules/assets/models/Asset";
import { resolveGenerationAccountOrEnvKey } from "@/modules/accounts/service";
import { recordAccountUsage } from "@/modules/accounts/selector";
import { getImageProvider } from "@/core/ai/registry";
import { uploadImageAsset } from "@/core/storage/cloudinary";
import { resolveActiveTemplate } from "@/modules/prompt-templates/service";
import { getProviderOverride } from "@/modules/settings/service";
import { onCharacterOrBackgroundReady } from "@/core/queue/orchestrator";
import { checkImageResolution } from "@/core/quality/checks";
import { QualityCheckFailedError } from "@/core/quality/errors";
import { resolveQualityTargets } from "@/core/production-engine/resolve-quality-targets";
import { routeSingleImage } from "@/core/production/image-route";
import { backgroundPrompt } from "@/core/ai/providers/image-prompts";

/** PDF Step 3 — Create Backgrounds. */
export async function processBackgroundImageJob(bullJob: BullJob<BullJobData>) {
  return withJobLifecycle(bullJob, async (jobDoc) => {
    if (!jobDoc.payload?.backgroundId) throw new Error("Job is missing backgroundId");
    const backgroundId = jobDoc.payload.backgroundId as string;

    const [background, project] = await Promise.all([
      Background.findOne({ _id: backgroundId, userId: jobDoc.userId }),
      Project.findOne({ _id: jobDoc.projectId, userId: jobDoc.userId }),
    ]);
    if (!background) throw new Error("Background not found");
    if (!project) throw new Error("Project not found");

    // Null when no pooled account is available but GEMINI_API_KEY is — the providers take an
    // optional context and fall back to that key themselves.
    const account = await resolveGenerationAccountOrEnvKey(jobDoc.userId);
    const context = account?.context;
    if (account) jobDoc.set("googleAccountId", account.accountId);
    await jobDoc.save();

    const providerId = await getProviderOverride(jobDoc.userId, "image");
    const style = project.style === "Custom" ? (project.customStyleDescription ?? "Custom") : project.style;
    const promptTemplateOverrides = project.promptTemplateOverrides as Record<string, string> | undefined;
    const templateOverride = await resolveActiveTemplate(jobDoc.userId, "background", promptTemplateOverrides?.background);

    const input = {
      description: background.description,
      category: background.category,
      style,
      lighting: background.lighting,
      aspectRatio: "4:5" as const,
      templateOverride,
    };

    // The router picks the provider and moves on from one that cannot serve at all — see
    // core/production/image-route.ts. Everything below is the same whichever route drew it.
    const image = await routeSingleImage(jobDoc, {
      preferredProviderId: providerId,
      prompt: backgroundPrompt(input),
      viaApi: (provider) => provider.generateBackground(input, context),
      flow: {
        projectId: jobDoc.projectId?.toString(),
        aspectRatio: "1:1",
        imageTarget: { kind: "background", backgroundId: background._id.toString() },
      },
    });
    if (account) await recordAccountUsage(account.accountId);

    const uploaded = await uploadImageAsset(image.data, {
      folder: `projects/${jobDoc.projectId}/backgrounds`,
      publicId: background._id.toString(),
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

    background.assetId = asset._id;
    await background.save();

    await onCharacterOrBackgroundReady(jobDoc.userId, jobDoc.projectId!.toString());

    return { assetId: asset._id.toString() };
  });
}
