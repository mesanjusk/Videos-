"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Check, Image as ImageIcon, Loader2, Sparkles } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";

export interface LibraryBackgroundItem {
  id: string;
  name: string;
  category: string;
  sourceProjectId: string;
  sourceProjectTitle: string;
  coverUrl: string | null;
}

export interface LibraryProjectOption {
  id: string;
  title: string;
}

export function LibraryManager({
  backgrounds,
  projects,
  targetProjectId,
}: {
  backgrounds: LibraryBackgroundItem[];
  projects: LibraryProjectOption[];
  targetProjectId: string | null;
}) {
  if (backgrounds.length === 0) {
    return (
      <EmptyState
        icon={ImageIcon}
        title="No backgrounds yet"
        description="Backgrounds you create in any project will show up here so you can reuse them elsewhere."
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {backgrounds.map((b) => (
        <LibraryCard
          key={b.id}
          name={b.name}
          subtitle={b.category}
          sourceProjectId={b.sourceProjectId}
          sourceProjectTitle={b.sourceProjectTitle}
          coverUrl={b.coverUrl}
          fallbackIcon={ImageIcon}
          projects={projects}
          targetProjectId={targetProjectId}
          cloneEndpoint={`/api/backgrounds/${b.id}/clone`}
          backHrefSuffix="backgrounds"
        />
      ))}
    </div>
  );
}

function LibraryCard({
  name,
  subtitle,
  sourceProjectId,
  sourceProjectTitle,
  coverUrl,
  fallbackIcon: FallbackIcon,
  projects,
  targetProjectId,
  cloneEndpoint,
  backHrefSuffix,
}: {
  name: string;
  subtitle?: string;
  sourceProjectId: string;
  sourceProjectTitle: string;
  coverUrl: string | null;
  fallbackIcon: typeof ImageIcon;
  projects: LibraryProjectOption[];
  targetProjectId: string | null;
  cloneEndpoint: string;
  backHrefSuffix: "backgrounds";
}) {
  const [pickerProjectId, setPickerProjectId] = useState<string>("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [addedToTitle, setAddedToTitle] = useState<string | null>(null);

  const otherProjects = projects.filter((p) => p.id !== sourceProjectId);
  // In "reuse into this project" mode (came from a project's Characters/Backgrounds page via
  // ?target=), only that project is a valid destination — skip it entirely if it's the source.
  const directTarget = targetProjectId && targetProjectId !== sourceProjectId ? targetProjectId : null;

  async function clone(targetId: string, targetTitle: string) {
    setStatus("loading");
    setError(null);
    const res = await fetch(cloneEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetProjectId: targetId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Couldn't add this to the project");
      setStatus("error");
      return;
    }
    setAddedToTitle(targetTitle);
    setStatus("done");
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
            {coverUrl ? (
              <Image src={coverUrl} alt={name} width={64} height={64} className="h-full w-full object-cover" />
            ) : (
              <Avatar className="h-10 w-10">
                <AvatarFallback>
                  <FallbackIcon className="h-4 w-4" />
                </AvatarFallback>
              </Avatar>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{name}</p>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
            <Badge variant="outline" className="mt-1">
              From {sourceProjectTitle}
            </Badge>
          </div>
        </div>

        {status === "done" ? (
          <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" />
            Added to {addedToTitle}
          </p>
        ) : directTarget ? (
          <Button size="sm" className="w-full" onClick={() => clone(directTarget, "this project")} disabled={status === "loading"}>
            {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Add to this project
          </Button>
        ) : otherProjects.length === 0 ? (
          <p className="text-xs text-muted-foreground">Create another project to reuse this here.</p>
        ) : (
          <div className="flex gap-2">
            <Select value={pickerProjectId} onValueChange={setPickerProjectId}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent>
                {otherProjects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={!pickerProjectId || status === "loading"}
              onClick={() => {
                const project = otherProjects.find((p) => p.id === pickerProjectId);
                if (project) clone(project.id, project.title);
              }}
            >
              {status === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
            </Button>
          </div>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        {directTarget && (
          <Link
            href={`/projects/${directTarget}/${backHrefSuffix}`}
            className="block text-center text-xs text-muted-foreground hover:underline"
          >
            Or go back to your project
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
