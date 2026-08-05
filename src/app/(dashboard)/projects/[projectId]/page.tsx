import Link from "next/link";
import { notFound } from "next/navigation";
import { Camera, Clapperboard, Film, History, Smile, Sparkles, Users, Image as ImageIcon } from "lucide-react";
import { requireUserId } from "@/core/auth/session";
import { getProject } from "@/modules/projects/service";
import { listJobsForProject } from "@/modules/jobs/service";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { HelpButton } from "@/components/shared/help-button";
import { EmptyState } from "@/components/shared/empty-state";
import { JobBadge } from "@/components/shared/job-badge";
import { GenerateStoryButton } from "./generate-story-button";
import { PipelineModeToggle } from "./pipeline-mode-toggle";

export default async function ProjectDetailPage({ params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireUserId();
  const { projectId } = await params;
  const [project, jobs] = await Promise.all([getProject(userId, projectId), listJobsForProject(userId, projectId)]);
  if (!project) notFound();

  const hasStory = (project.storyJson?.scenes?.length ?? 0) > 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
          <Badge variant="outline">{project.style}</Badge>
          <HelpButton text="This is your project's home base. Generate the story first, then move on to characters, backgrounds, scenes, and finally editing & export." />
        </div>
        <p className="text-sm text-muted-foreground">
          {project.targetPlatform} · {project.durationSeconds}s · {project.language}
        </p>
      </div>

      <PipelineModeToggle projectId={projectId} pipelineMode={project.pipelineMode ?? "semi"} />

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Overall progress</span>
          <span>{project.completionPercent ?? 0}%</span>
        </div>
        <Progress value={project.completionPercent ?? 0} />
      </div>

      <div id="story" className="scroll-mt-6" />

      {!hasStory && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                {project.storyInputMode === "script" ? "Your script" : "Your idea"}
              </CardTitle>
              <CardDescription>This is what the story generator will expand into scenes.</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm">{project.premise || project.pastedScript}</p>
            </CardContent>
          </Card>

          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <p className="font-medium">Ready to write your story</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                We&rsquo;ll turn your idea into an 8-scene script with dialogue, camera angles, and emotion for each
                scene — usually ready in under a minute.
              </p>
              <GenerateStoryButton projectId={projectId} />
            </CardContent>
          </Card>
        </>
      )}

      {hasStory && (
        <>
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <Link href={`/projects/${projectId}/characters`}>
                <Users className="h-4 w-4" />
                Characters
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/projects/${projectId}/backgrounds`}>
                <ImageIcon className="h-4 w-4" />
                Backgrounds
              </Link>
            </Button>
            <Button asChild>
              <Link href={`/projects/${projectId}/scenes`}>
                <Clapperboard className="h-4 w-4" />
                Scenes
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/projects/${projectId}/edit`}>
                <Film className="h-4 w-4" />
                Edit & export
              </Link>
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{project.storyJson?.title}</CardTitle>
              <CardDescription>{project.storyJson?.scenes?.length ?? 0} scenes</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {project.storyJson?.scenes?.map((scene) => (
                <div key={scene.index} className="rounded-lg border border-border p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium">Scene {scene.index}</p>
                    <div className="flex gap-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Camera className="h-3 w-3" />
                        {scene.camera}
                      </span>
                      <span className="flex items-center gap-1">
                        <Smile className="h-3 w-3" />
                        {scene.emotion}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm">{scene.visual}</p>
                  {scene.dialogue && <p className="mt-1 text-sm italic text-muted-foreground">&ldquo;{scene.dialogue}&rdquo;</p>}
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            History
          </CardTitle>
          <CardDescription>Every generation job run for this project, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <EmptyState icon={History} title="No activity yet" description="Generation jobs for this project will show up here." />
          ) : (
            <ul className="space-y-3">
              {jobs.map((job) => (
                <li key={job._id.toString()} className="flex items-start justify-between gap-3 border-b border-border pb-3 text-sm last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate">
                      {job.type.replace(/_/g, " ")}
                      {job.characterId && typeof job.characterId === "object" && (job.characterId as { name?: string }).name
                        ? ` — ${(job.characterId as { name?: string }).name}`
                        : ""}
                    </p>
                    <p className="text-xs text-muted-foreground">{new Date(job.createdAt).toLocaleString()}</p>
                    {job.error && <p className="mt-1 text-xs text-destructive">{job.error}</p>}
                  </div>
                  <div className="shrink-0">
                    <JobBadge status={job.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
