import type { Job as BullJob } from "bullmq";
import { withJobLifecycle, type BullJobData } from "./helpers";
import { Project } from "@/modules/projects/models/Project";
import { resolveGenerationAccount } from "@/modules/accounts/service";
import { recordAccountUsage } from "@/modules/accounts/selector";
import { getStoryProvider } from "@/core/ai/registry";
import { createScenesFromStory } from "@/modules/scenes/service";
import { resolveActiveTemplate } from "@/modules/prompt-templates/service";
import { getProviderOverride } from "@/modules/settings/service";

/** PDF Step 1 — Write the Story. */
export async function processStoryJob(bullJob: BullJob<BullJobData>) {
  return withJobLifecycle(bullJob, async (jobDoc) => {
    const project = await Project.findOne({ _id: jobDoc.projectId, userId: jobDoc.userId });
    if (!project) throw new Error("Project not found");

    const { accountId, context } = await resolveGenerationAccount(jobDoc.userId);
    jobDoc.set("googleAccountId", accountId);
    await jobDoc.save();

    // For a pasted script we still route through the same "expand a premise" prompt — the model
    // is asked to structure it into the scene JSON rather than invent new content. A dedicated
    // "restructure this exact script" template (preserving the original wording verbatim) is a
    // reasonable follow-up but isn't implemented yet.
    const premise = project.storyInputMode === "script" ? (project.pastedScript ?? "") : (project.premise ?? "");

    const promptTemplateOverrides = project.promptTemplateOverrides as Record<string, string> | undefined;
    const templateOverride = await resolveActiveTemplate(jobDoc.userId, "story", promptTemplateOverrides?.story);
    const providerId = await getProviderOverride(jobDoc.userId, "story");
    const provider = getStoryProvider(providerId);
    const story = await provider.generateStory(
      {
        premise,
        language: project.language,
        sceneCount: project.sceneCount ?? 8,
        characterCount: 2,
        targetDurationSeconds: project.durationSeconds,
        templateOverride,
      },
      context,
    );
    await recordAccountUsage(accountId);

    project.set("storyJson", { title: story.title, characters: story.characters, scenes: story.scenes });
    project.status = "story";
    project.completionPercent = Math.max(project.completionPercent ?? 0, 20);
    await project.save();

    // Scene Planning (PDF workflow, between Backgrounds and Images) happens automatically here so a
    // beginner never has to manually transcribe the story into scenes — the Scene Manager (Stage 4)
    // just assigns characters/backgrounds to what's already there.
    await createScenesFromStory(jobDoc.userId, jobDoc.projectId!.toString(), story.scenes);

    return { title: story.title, sceneCount: story.scenes.length };
  });
}
