import { connectToDatabase } from "@/core/db/mongoose";
import { Project } from "./models/Project";
import type { ProjectStatus } from "./constants";
import type { CreateProjectInput } from "./schema";

/** Rough guide for "always show the next recommended action" — refined once queue-driven stages (3+) exist. */
const STATUS_COMPLETION: Record<ProjectStatus, number> = {
  draft: 5,
  story: 20,
  characters: 40,
  backgrounds: 55,
  scenes: 75,
  rendering: 90,
  done: 100,
};

export async function createProject(userId: string, input: CreateProjectInput) {
  await connectToDatabase();
  return Project.create({
    userId,
    title: input.title,
    language: input.language,
    videoType: input.videoType,
    durationSeconds: input.durationSeconds,
    targetPlatform: input.targetPlatform,
    style: input.style,
    customStyleDescription: input.customStyleDescription,
    storyInputMode: input.storyInputMode,
    premise: input.premise,
    pastedScript: input.pastedScript,
    status: "draft",
    completionPercent: STATUS_COMPLETION.draft,
  });
}

export async function listProjects(userId: string) {
  await connectToDatabase();
  return Project.find({ userId }).sort({ updatedAt: -1 }).lean();
}

export async function getProject(userId: string, projectId: string) {
  await connectToDatabase();
  return Project.findOne({ _id: projectId, userId }).lean();
}

export async function deleteProject(userId: string, projectId: string) {
  await connectToDatabase();
  await Project.deleteOne({ _id: projectId, userId });
}

export async function countProjectsByStatus(userId: string): Promise<Record<ProjectStatus, number>> {
  await connectToDatabase();
  const rows = await Project.aggregate<{ _id: ProjectStatus; count: number }>([
    { $match: { userId } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const base = Object.fromEntries(Object.keys(STATUS_COMPLETION).map((s) => [s, 0])) as Record<ProjectStatus, number>;
  for (const row of rows) base[row._id] = row.count;
  return base;
}

/** The single next action a beginner should take on a given project — drives dashboard/detail-page CTAs. */
export function nextActionForStatus(status: ProjectStatus): { label: string; href: (projectId: string) => string } {
  switch (status) {
    case "draft":
      return { label: "Generate story", href: (id) => `/projects/${id}` };
    case "story":
      return { label: "Create characters", href: (id) => `/projects/${id}/characters` };
    case "characters":
      return { label: "Create backgrounds", href: (id) => `/projects/${id}/backgrounds` };
    case "backgrounds":
      return { label: "Plan scenes", href: (id) => `/projects/${id}/scenes` };
    case "scenes":
      return { label: "Generate video & voice", href: (id) => `/projects/${id}/scenes` };
    case "rendering":
      return { label: "View render progress", href: (id) => `/projects/${id}/edit` };
    case "done":
      return { label: "Download & export", href: (id) => `/projects/${id}/edit` };
  }
}

export async function setProjectMusic(userId: string, projectId: string, assetId: string) {
  await connectToDatabase();
  return Project.findOneAndUpdate({ _id: projectId, userId }, { $set: { musicAssetId: assetId } }, { new: true });
}

export async function setWatermarkUrl(userId: string, projectId: string, watermarkImageUrl: string | null) {
  await connectToDatabase();
  return Project.findOneAndUpdate(
    { _id: projectId, userId },
    watermarkImageUrl ? { $set: { watermarkImageUrl } } : { $unset: { watermarkImageUrl: "" } },
    { new: true },
  );
}

export async function setPipelineMode(userId: string, projectId: string, pipelineMode: "full" | "semi" | "manual") {
  await connectToDatabase();
  return Project.findOneAndUpdate({ _id: projectId, userId }, { $set: { pipelineMode } }, { new: true });
}
