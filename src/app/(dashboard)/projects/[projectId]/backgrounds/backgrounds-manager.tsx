"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Image as ImageIcon, LibraryBig, Loader2, MoreVertical, Plus, RefreshCcw } from "lucide-react";
import { createBackgroundSchema, type CreateBackgroundInput } from "@/modules/backgrounds/schema";
import { BACKGROUND_CATEGORIES } from "@/modules/backgrounds/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { useJobPolling } from "@/hooks/use-job-polling";

export interface BackgroundListItem {
  id: string;
  name: string;
  category: string;
  description: string;
  url: string | null;
}

export function BackgroundsManager({ projectId, initialBackgrounds }: { projectId: string; initialBackgrounds: BackgroundListItem[] }) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingJobs, setPendingJobs] = useState<Record<string, string>>({});

  async function regenerate(backgroundId: string) {
    const res = await fetch(`/api/backgrounds/${backgroundId}`, { method: "POST" });
    if (res.ok) {
      const { job } = await res.json();
      setPendingJobs((prev) => ({ ...prev, [backgroundId]: job._id }));
    }
  }

  async function remove(backgroundId: string) {
    await fetch(`/api/backgrounds/${backgroundId}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild>
          <Link href={`/library?target=${projectId}`}>
            <LibraryBig className="h-4 w-4" />
            Reuse from another project
          </Link>
        </Button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              Add background
            </Button>
          </DialogTrigger>
          <DialogContent>
            <AddBackgroundForm
              projectId={projectId}
              onSuccess={(backgroundId, jobId) => {
                setDialogOpen(false);
                setPendingJobs((prev) => ({ ...prev, [backgroundId]: jobId }));
                router.refresh();
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {initialBackgrounds.length === 0 && Object.keys(pendingJobs).length === 0 ? (
        <EmptyState
          icon={ImageIcon}
          title="No backgrounds yet"
          description="Add every place your story happens — we'll generate a consistent, Pixar-quality scene for each."
          action={
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Add your first background
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {initialBackgrounds.map((background) => (
            <BackgroundCard
              key={background.id}
              background={background}
              pendingJobId={pendingJobs[background.id] ?? null}
              onRegenerate={() => regenerate(background.id)}
              onDelete={() => remove(background.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BackgroundCard({
  background,
  pendingJobId,
  onRegenerate,
  onDelete,
}: {
  background: BackgroundListItem;
  pendingJobId: string | null;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  const { job, isDone } = useJobPolling(pendingJobId);

  useEffect(() => {
    if (isDone) router.refresh();
  }, [isDone, router]);

  const isGenerating = pendingJobId && !isDone;

  return (
    <Card>
      <div className="aspect-[4/5] w-full overflow-hidden rounded-t-xl bg-muted">
        {isGenerating ? (
          <Skeleton className="h-full w-full rounded-none" />
        ) : background.url ? (
          <Image src={background.url} alt={background.name} width={400} height={500} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <ImageIcon className="h-8 w-8" />
          </div>
        )}
      </div>
      <CardContent className="flex items-start justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{background.name}</p>
          <p className="truncate text-xs capitalize text-muted-foreground">{background.category}</p>
          {isGenerating && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Generating...
            </p>
          )}
          {job?.status === "failed" && <p className="mt-1 text-xs text-destructive">{job.error}</p>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Background actions">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onRegenerate} disabled={!!isGenerating}>
              <RefreshCcw className="h-4 w-4" />
              Regenerate
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onSelect={onDelete}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardContent>
    </Card>
  );
}

function AddBackgroundForm({
  projectId,
  onSuccess,
}: {
  projectId: string;
  onSuccess: (backgroundId: string, jobId: string) => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { isSubmitting, errors },
  } = useForm<CreateBackgroundInput>({
    resolver: zodResolver(createBackgroundSchema),
    defaultValues: { category: "outdoor", lighting: "morning" },
  });
  const category = watch("category");

  async function onSubmit(values: CreateBackgroundInput) {
    setServerError(null);
    const res = await fetch(`/api/projects/${projectId}/backgrounds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      setServerError("Couldn't create this background. Please try again.");
      return;
    }
    const { background, job } = await res.json();
    onSuccess(background._id, job._id);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <DialogHeader>
        <DialogTitle>Add a background</DialogTitle>
        <DialogDescription>Describe the place — we&rsquo;ll render it in your project&rsquo;s style.</DialogDescription>
      </DialogHeader>
      <div className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" placeholder="e.g. Market street" {...register("name")} />
          {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={(v) => setValue("category", v as CreateBackgroundInput["category"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BACKGROUND_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c} className="capitalize">
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lighting">Lighting</Label>
            <Input id="lighting" placeholder="e.g. morning" {...register("lighting")} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="description">Description</Label>
          <Input id="description" placeholder="e.g. A colorful street market in India with fruit stalls" {...register("description")} />
          {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
        </div>
        {serverError && <p className="text-sm text-destructive">{serverError}</p>}
      </div>
      <DialogFooter>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Create & generate
        </Button>
      </DialogFooter>
    </form>
  );
}
