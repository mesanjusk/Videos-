import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { connectToDatabase } from "@/core/db/mongoose";
import { Project } from "@/modules/projects/models/Project";
import { Scene } from "@/modules/scenes/models/Scene";
import { Job } from "@/modules/jobs/models/Job";
import { Asset } from "@/modules/assets/models/Asset";
import { findAccountWithFlowSession } from "@/modules/accounts/service";
import { computeProgress } from "@/core/production/progress";

export const dynamic = "force-dynamic";

/**
 * Everything the one-screen studio view polls, in a single request.
 *
 * Deliberately one endpoint rather than the four it replaces (project, scenes, jobs, accounts): the
 * page it feeds polls every few seconds for as long as a video takes to make, and four round trips
 * on that loop is four times the load for a screen that shows one number and one sentence.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    await connectToDatabase();

    const project = await Project.findOne({ _id: id, userId })
      .select("title status completionPercent finalVideoAssetId thumbnailAssetId storyJson.title")
      .lean();
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [scenes, jobs, flowAccount] = await Promise.all([
      Scene.find({ userId, projectId: id }).select("status").lean(),
      Job.find({ userId, projectId: id }).select("status type error").lean(),
      // Cheap and cached upstream; this is what turns "waiting" into the one actionable setup step.
      findAccountWithFlowSession(userId).catch(() => null),
    ]);

    const progress = computeProgress({
      projectStatus: project.status ?? "draft",
      hasFinalVideo: !!project.finalVideoAssetId,
      sceneStatuses: scenes.map((s) => s.status ?? "pending"),
      jobStatuses: jobs.map((j) => j.status),
      canMakeVideo: !!flowAccount,
    });

    // Only loaded once there is something to play — the studio view shows the player and the
    // download button from these, and neither exists before the render finishes.
    const [video, thumbnail] = await Promise.all([
      project.finalVideoAssetId ? Asset.findOne({ _id: project.finalVideoAssetId, userId }).select("url").lean() : null,
      project.thumbnailAssetId ? Asset.findOne({ _id: project.thumbnailAssetId, userId }).select("url").lean() : null,
    ]);

    const failedJob = jobs.find((j) => j.status === "failed");

    return NextResponse.json({
      title: project.storyJson?.title || project.title,
      progress: {
        ...progress,
        href: progress.action?.target === "accounts" ? "/accounts" : `/projects/${id}/scenes`,
      },
      videoUrl: video?.url ?? null,
      thumbnailUrl: thumbnail?.url ?? null,
      // The first failure's own message and id, so "something went wrong" can be both explained
      // and acted on here, rather than sending someone to a history page to find out what broke and
      // giving them nothing to do about it when they get there.
      failure: failedJob?.error ?? null,
      failedJobId: failedJob?._id.toString() ?? null,
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to load progress" }, { status: 500 });
  }
}
