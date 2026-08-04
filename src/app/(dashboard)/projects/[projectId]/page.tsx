import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";
import { requireUserId } from "@/core/auth/session";
import { getProject } from "@/modules/projects/service";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";

/**
 * Placeholder detail page — story generation (and the rest of the pipeline UI: characters,
 * backgrounds, scenes, voice, render, export) is wired up in Stages 3-5. This exists so the
 * wizard and dashboard "next action" links resolve to something real in Stage 2.
 */
export default async function ProjectDetailPage({ params }: { params: Promise<{ projectId: string }> }) {
  const userId = await requireUserId();
  const { projectId } = await params;
  const project = await getProject(userId, projectId);
  if (!project) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
          <Badge variant="outline">{project.style}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {project.targetPlatform} · {project.durationSeconds}s · {project.language}
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Overall progress</span>
          <span>{project.completionPercent ?? 0}%</span>
        </div>
        <Progress value={project.completionPercent ?? 0} />
      </div>

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
          <p className="font-medium">Story, character, and scene generation is coming next</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            This project is saved as a draft. The generation pipeline (story → characters → backgrounds → scenes →
            video → voice → edit → thumbnail) connects here in the next build stage.
          </p>
          <Button disabled>Generate story (coming soon)</Button>
        </CardContent>
      </Card>
    </div>
  );
}
