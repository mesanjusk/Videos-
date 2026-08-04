import type { Job as BullJob } from "bullmq";
import { withJobLifecycle, type BullJobData } from "./helpers";
import { Project } from "@/modules/projects/models/Project";
import { Character } from "@/modules/characters/models/Character";
import { Asset } from "@/modules/assets/models/Asset";
import { resolveGenerationAccount } from "@/modules/accounts/service";
import { recordAccountUsage } from "@/modules/accounts/selector";
import { getImageProvider } from "@/core/ai/registry";
import { uploadImageAsset } from "@/core/storage/cloudinary";
import type { CharacterPose } from "@/core/ai/types";

const DEFAULT_POSES: CharacterPose[] = ["front-view", "happy", "walking-pose"];

/** PDF Step 2 — Create Characters (character turnaround sheet), a subset of poses per generation. */
export async function processCharacterImageJob(bullJob: BullJob<BullJobData>) {
  return withJobLifecycle(bullJob, async (jobDoc) => {
    if (!jobDoc.characterId) throw new Error("Job is missing characterId");
    const [character, project] = await Promise.all([
      Character.findOne({ _id: jobDoc.characterId, userId: jobDoc.userId }),
      Project.findOne({ _id: jobDoc.projectId, userId: jobDoc.userId }),
    ]);
    if (!character) throw new Error("Character not found");
    if (!project) throw new Error("Project not found");

    const { accountId, context } = await resolveGenerationAccount(jobDoc.userId);
    jobDoc.set("googleAccountId", accountId);
    await jobDoc.save();

    const poses = (jobDoc.payload?.poses as CharacterPose[] | undefined) ?? DEFAULT_POSES;
    const provider = getImageProvider();
    const style = project.style === "Custom" ? (project.customStyleDescription ?? "Custom") : project.style;

    const images = await provider.generateCharacterSheet(
      {
        spec: {
          name: character.name,
          style,
          age: character.spec?.age ?? undefined,
          bodyType: character.spec?.bodyType ?? undefined,
          face: character.spec?.face ?? undefined,
          eyes: character.spec?.eyes ?? undefined,
          hair: character.spec?.hair ?? undefined,
          clothes: character.spec?.clothes ?? undefined,
          shoes: character.spec?.shoes ?? undefined,
          accessories: character.spec?.accessories ?? undefined,
          personality: character.spec?.personality ?? undefined,
        },
        poses,
        aspectRatio: "4:5",
      },
      context,
    );
    await recordAccountUsage(accountId);

    const sheetAssets = [];
    for (const pose of poses) {
      const image = images[pose];
      if (!image) continue;
      const uploaded = await uploadImageAsset(image.data, {
        folder: `projects/${jobDoc.projectId}/characters/${character._id.toString()}`,
        publicId: pose,
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
      sheetAssets.push({ pose, assetId: asset._id });
    }

    character.set("sheetAssets", sheetAssets);
    await character.save();

    return { poseCount: sheetAssets.length };
  });
}
