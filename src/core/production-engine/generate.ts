import type { Types } from "mongoose";
import { connectToDatabase } from "@/core/db/mongoose";
import { Project } from "@/modules/projects/models/Project";
import { getProductionProfileForGeneration } from "@/modules/production-profiles/service";
import { assignCharacterToProject } from "@/modules/characters/service";
import { createProductionRun } from "@/modules/production-runs/service";
import { enqueueJob } from "@/modules/jobs/service";
import { composeStyleDescription } from "./style-description";
import type { CharacterDoc } from "@/modules/characters/models/Character";
import type { StylePackDoc } from "@/modules/style-packs/models/StylePack";
import type { PromptTemplateDoc } from "@/modules/prompt-templates/models/PromptTemplate";

// getProductionProfileForGeneration's populate + lean() resolves these as plain objects with a
// real _id (Types.ObjectId), which InferSchemaType-derived Doc types don't declare by default.
type PopulatedCharacter = CharacterDoc & { _id: Types.ObjectId };
type PopulatedPromptTemplate = PromptTemplateDoc & { _id: Types.ObjectId };

export interface GenerateFromProfileResult {
  projectId: string;
  runId: string;
  jobId: string;
}

/**
 * The "topic → Generate → everything else happens" entry point (Module 6). Creates a Project
 * pre-filled from the profile's defaults, assigns its referenced characters
 * (modules/characters/service.ts#assignCharacterToProject — links them in, never copies), pins its
 * prompt-template presets, sets pipelineMode="full" so core/queue/orchestrator.ts's existing
 * auto-chain takes over once the story exists, and enqueues the story job. Everything after that —
 * scene image → video → voice → lipsync → render → thumbnail — is the orchestrator this module
 * doesn't reimplement.
 */
export async function generateFromProfile(
  userId: string,
  profileId: string,
  topic: string,
  notes?: string,
): Promise<GenerateFromProfileResult> {
  await connectToDatabase();
  const profile = await getProductionProfileForGeneration(userId, profileId);
  if (!profile) throw new Error("Production profile not found");

  const characters = (profile.characterIds ?? []) as unknown as PopulatedCharacter[];
  const stylePack = profile.stylePackId as unknown as StylePackDoc | undefined;
  const promptTemplates = (profile.promptTemplateIds ?? []) as unknown as PopulatedPromptTemplate[];

  const style = stylePack ? "Custom" : "Pixar";
  const customStyleDescription = stylePack ? composeStyleDescription(stylePack) || stylePack.category || stylePack.name : undefined;

  const durationSeconds = Math.min(600, Math.max(15, profile.sceneDurationSeconds * profile.defaultSceneCount));

  const promptTemplateOverrides = Object.fromEntries(promptTemplates.map((t) => [t.scope, t._id.toString()]));

  const project = await Project.create({
    userId,
    title: topic.slice(0, 120),
    language: profile.language,
    durationSeconds,
    style,
    customStyleDescription,
    storyInputMode: "idea",
    premise: notes ? `${topic}\n\n${notes}` : topic,
    status: "draft",
    completionPercent: 5,
    pipelineMode: "full",
    sceneCount: profile.defaultSceneCount,
    activeProfileId: profile._id,
    promptTemplateOverrides,
  });

  await Promise.all(
    characters.map((character) =>
      assignCharacterToProject(userId, character._id.toString(), project._id.toString()).catch(() => null),
    ),
  );

  const characterVersionsUsed = Object.fromEntries(characters.map((c) => [c._id.toString(), c.version ?? 1]));
  const providerUsed = Object.fromEntries(
    Object.entries(profile.render?.providerOverrides ?? {}).filter(([, id]) => !!id),
  ) as Record<string, string>;

  const run = await createProductionRun({
    userId,
    projectId: project._id.toString(),
    profileId,
    profileVersion: profile.version,
    topic,
    notes,
    promptTemplateVersionsUsed: promptTemplateOverrides,
    characterVersionsUsed,
    providerUsed,
  });

  const job = await enqueueJob({ userId, projectId: project._id.toString(), type: "story", payload: {} });

  return { projectId: project._id.toString(), runId: run._id.toString(), jobId: job._id.toString() };
}
