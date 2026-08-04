import type { Job as BullJob } from "bullmq";
import { withJobLifecycle, type BullJobData } from "./helpers";
import { Project } from "@/modules/projects/models/Project";
import { Background } from "@/modules/backgrounds/models/Background";
import { Asset } from "@/modules/assets/models/Asset";
import { resolveGenerationAccount } from "@/modules/accounts/service";
import { recordAccountUsage } from "@/modules/accounts/selector";
import { getImageProvider } from "@/core/ai/registry";
import { uploadImageAsset } from "@/core/storage/cloudinary";

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

    const { accountId, context } = await resolveGenerationAccount(jobDoc.userId);
    jobDoc.set("googleAccountId", accountId);
    await jobDoc.save();

    const provider = getImageProvider();
    const style = project.style === "Custom" ? (project.customStyleDescription ?? "Custom") : project.style;

    const image = await provider.generateBackground(
      {
        description: background.description,
        category: background.category,
        style,
        lighting: background.lighting,
        aspectRatio: "4:5",
      },
      context,
    );
    await recordAccountUsage(accountId);

    const uploaded = await uploadImageAsset(image.data, {
      folder: `projects/${jobDoc.projectId}/backgrounds`,
      publicId: background._id.toString(),
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

    background.assetId = asset._id;
    await background.save();

    return { assetId: asset._id.toString() };
  });
}
