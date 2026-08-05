"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, LibraryBig, MoreVertical, Plus, RefreshCcw, UploadCloud, Users } from "lucide-react";
import { createCharacterSchema, type CreateCharacterInput } from "@/modules/characters/schema";
import { useCloudinaryUpload } from "@/hooks/use-cloudinary-upload";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { QualityWarnings } from "@/components/shared/quality-warnings";
import { useJobPolling } from "@/hooks/use-job-polling";

export interface CharacterListItem {
  id: string;
  name: string;
  role?: string;
  personality?: string;
  sheetAssets: { pose: string; url: string }[];
}

export function CharactersManager({ projectId, initialCharacters }: { projectId: string; initialCharacters: CharacterListItem[] }) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingJobs, setPendingJobs] = useState<Record<string, string>>({}); // characterId -> jobId

  async function regenerate(characterId: string) {
    const res = await fetch(`/api/characters/${characterId}/sheet`, { method: "POST" });
    if (res.ok) {
      const { job } = await res.json();
      setPendingJobs((prev) => ({ ...prev, [characterId]: job._id }));
    }
  }

  async function remove(characterId: string) {
    await fetch(`/api/characters/${characterId}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <Button variant="outline" asChild>
          <Link href={`/characters?target=${projectId}`}>
            <LibraryBig className="h-4 w-4" />
            Reuse from the character library
          </Link>
        </Button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              Add character
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <AddCharacterForm
              projectId={projectId}
              onSuccess={(characterId, jobId) => {
                setDialogOpen(false);
                setPendingJobs((prev) => ({ ...prev, [characterId]: jobId }));
                router.refresh();
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {initialCharacters.length === 0 && Object.keys(pendingJobs).length === 0 ? (
        <EmptyState
          icon={Users}
          title="No characters yet"
          description="Add your first character — we'll generate a full turnaround sheet (poses and expressions) you can reuse in every scene."
          action={
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Add your first character
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {initialCharacters.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              pendingJobId={pendingJobs[character.id] ?? null}
              onRegenerate={() => regenerate(character.id)}
              onDelete={() => remove(character.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CharacterCard({
  character,
  pendingJobId,
  onRegenerate,
  onDelete,
}: {
  character: CharacterListItem;
  pendingJobId: string | null;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  const router = useRouter();
  const { job, isDone } = useJobPolling(pendingJobId);
  const { upload, uploading, error: uploadError } = useCloudinaryUpload(`/api/characters/${character.id}/sheet/upload-params`);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isDone) router.refresh();
  }, [isDone, router]);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const uploaded = await upload(file);
    if (!uploaded) return;
    await fetch(`/api/characters/${character.id}/sheet/upload`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(uploaded),
    });
    router.refresh();
  }

  const isGenerating = pendingJobId && !isDone;
  const cover = character.sheetAssets.find((s) => s.pose === "front-view") ?? character.sheetAssets[0];

  return (
    <Card>
      <CardContent className="flex gap-4 p-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
          {isGenerating || uploading ? (
            <Skeleton className="h-full w-full" />
          ) : cover ? (
            <Image src={cover.url} alt={character.name} width={80} height={80} className="h-full w-full object-cover" />
          ) : (
            <Avatar className="h-12 w-12">
              <AvatarFallback>{character.name.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-medium">{character.name}</p>
              {character.role && <p className="text-xs text-muted-foreground">{character.role}</p>}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Character actions">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onRegenerate} disabled={!!isGenerating}>
                  <RefreshCcw className="h-4 w-4" />
                  Regenerate with AI
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => fileInputRef.current?.click()} disabled={uploading}>
                  <UploadCloud className="h-4 w-4" />
                  Upload my own image
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" onSelect={onDelete}>
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          </div>
          {isGenerating ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Generating turnaround sheet...
            </p>
          ) : uploading ? (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Uploading...
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">{character.sheetAssets.length} images ready</p>
          )}
          {job?.status === "failed" && <p className="mt-1 text-xs text-destructive">{job.error}</p>}
          <QualityWarnings job={job} />
          {uploadError && <p className="mt-1 text-xs text-destructive">{uploadError}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function AddCharacterForm({
  projectId,
  onSuccess,
}: {
  projectId: string;
  onSuccess: (characterId: string, jobId: string) => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<CreateCharacterInput>({ resolver: zodResolver(createCharacterSchema) });

  async function onSubmit(values: CreateCharacterInput) {
    setServerError(null);
    const res = await fetch(`/api/projects/${projectId}/characters`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      setServerError("Couldn't create this character. Please try again.");
      return;
    }
    const { character, job } = await res.json();
    onSuccess(character._id, job._id);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <DialogHeader>
        <DialogTitle>Add a character</DialogTitle>
        <DialogDescription>We&rsquo;ll generate a turnaround sheet — front, side, and expressions.</DialogDescription>
      </DialogHeader>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" placeholder="e.g. Ravi" {...register("name")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="role">Role</Label>
          <Input id="role" placeholder="e.g. Hero" {...register("role")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="age">Age</Label>
          <Input id="age" placeholder="e.g. 10 years old" {...register("age")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bodyType">Body type</Label>
          <Input id="bodyType" placeholder="e.g. Short and stocky" {...register("bodyType")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="face">Face</Label>
          <Input id="face" placeholder="e.g. Round, freckled" {...register("face")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="eyes">Eyes</Label>
          <Input id="eyes" placeholder="e.g. Big brown eyes" {...register("eyes")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hair">Hair</Label>
          <Input id="hair" placeholder="e.g. Curly black hair" {...register("hair")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="clothes">Clothes</Label>
          <Input id="clothes" placeholder="e.g. Blue striped t-shirt" {...register("clothes")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="shoes">Shoes</Label>
          <Input id="shoes" placeholder="e.g. Red sneakers" {...register("shoes")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="accessories">Accessories</Label>
          <Input id="accessories" placeholder="e.g. Backpack" {...register("accessories")} />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="personality">Personality</Label>
          <Input id="personality" placeholder="e.g. Curious and brave" {...register("personality")} />
        </div>
      </div>
      {serverError && <p className="mt-3 text-sm text-destructive">{serverError}</p>}
      <DialogFooter>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Create & generate
        </Button>
      </DialogFooter>
    </form>
  );
}
