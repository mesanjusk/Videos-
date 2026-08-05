"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Clapperboard, History, Loader2, MoreVertical, Plus, Users, Video } from "lucide-react";
import { createCharacterSchema, type CreateCharacterInput } from "@/modules/characters/schema";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
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
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";

export interface LibraryCharacter {
  id: string;
  name: string;
  role?: string;
  spec: {
    age?: string; bodyType?: string; face?: string; eyes?: string; hair?: string;
    clothes?: string; shoes?: string; accessories?: string; personality?: string;
  };
  masterPrompt?: string;
  animationStyle?: string;
  colorPalette: string[];
  voiceProfile?: { gender?: "male" | "female" | "neutral"; age?: number; tone?: string };
  version: number;
  versionCount: number;
  projectCount: number;
  hasHomeProject: boolean;
  sheetPoses: string[];
  coverUrl: string | null;
}

export interface LibraryProjectOption {
  id: string;
  title: string;
}

type EditableFields = CreateCharacterInput;

const SPEC_FIELDS: { key: keyof EditableFields; label: string; placeholder: string }[] = [
  { key: "role", label: "Role", placeholder: "e.g. Hero" },
  { key: "age", label: "Age", placeholder: "e.g. 10 years old" },
  { key: "bodyType", label: "Body type", placeholder: "e.g. Short and stocky" },
  { key: "face", label: "Face", placeholder: "e.g. Round, freckled" },
  { key: "eyes", label: "Eyes", placeholder: "e.g. Big brown eyes" },
  { key: "hair", label: "Hair", placeholder: "e.g. Curly black hair" },
  { key: "clothes", label: "Clothes", placeholder: "e.g. Blue striped t-shirt" },
  { key: "shoes", label: "Shoes", placeholder: "e.g. Red sneakers" },
  { key: "accessories", label: "Accessories", placeholder: "e.g. Backpack" },
];

const ANIMATION_STYLES = ["Pixar", "Disney", "Anime", "Realistic", "3D", "Custom"];

export function CharacterLibraryManager({
  characters,
  projects,
  targetProjectId,
}: {
  characters: LibraryCharacter[];
  projects: LibraryProjectOption[];
  targetProjectId?: string | null;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<LibraryCharacter | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              New character
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
            <CharacterForm
              mode="create"
              onSuccess={() => {
                setCreateOpen(false);
                router.refresh();
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {characters.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No characters yet"
          description="Create a character once — name, look, voice, and expressions — and reuse it in every project from here on."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Create your first character
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {characters.map((c) => (
            <CharacterCard
              key={c.id}
              character={c}
              projects={projects}
              targetProjectId={targetProjectId ?? null}
              onEdit={() => setEditing(c)}
            />
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          {editing && (
            <CharacterForm
              mode="edit"
              character={editing}
              onSuccess={() => {
                setEditing(null);
                router.refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CharacterCard({
  character,
  projects,
  targetProjectId,
  onEdit,
}: {
  character: LibraryCharacter;
  projects: LibraryProjectOption[];
  targetProjectId: string | null;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [assignOpen, setAssignOpen] = useState(false);
  const [videosOpen, setVideosOpen] = useState(false);
  const [pickerProjectId, setPickerProjectId] = useState("");
  const [assignStatus, setAssignStatus] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function assignTo(projectId: string) {
    setAssignStatus("loading");
    const res = await fetch(`/api/characters/${character.id}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetProjectId: projectId }),
    });
    if (!res.ok) {
      setAssignStatus("error");
      return;
    }
    setAssignStatus("done");
    router.refresh();
  }

  async function remove() {
    if (!confirm(`Delete "${character.name}" from the library? This can't be undone.`)) return;
    await fetch(`/api/characters/${character.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
            {character.coverUrl ? (
              <Image src={character.coverUrl} alt={character.name} width={64} height={64} className="h-full w-full object-cover" />
            ) : (
              <Avatar className="h-10 w-10">
                <AvatarFallback>{character.name.slice(0, 1).toUpperCase()}</AvatarFallback>
              </Avatar>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{character.name}</p>
                {character.role && <p className="truncate text-xs text-muted-foreground">{character.role}</p>}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Character actions">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={onEdit}>Edit & version history</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setVideosOpen(true)}>
                    <Video className="h-4 w-4" />
                    Previous videos
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-destructive" onSelect={remove}>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {character.animationStyle && <Badge variant="outline">{character.animationStyle}</Badge>}
              <Badge variant="outline">v{character.version}</Badge>
              <Badge variant="outline">{character.projectCount} project{character.projectCount === 1 ? "" : "s"}</Badge>
            </div>
            {character.colorPalette.length > 0 && (
              <div className="mt-1.5 flex gap-1">
                {character.colorPalette.map((hex) => (
                  <span key={hex} title={hex} className="h-3.5 w-3.5 rounded-full border border-border" style={{ backgroundColor: hex }} />
                ))}
              </div>
            )}
          </div>
        </div>

        {!character.hasHomeProject && (
          <p className="text-xs text-muted-foreground">Assign to a project to unlock AI sheet generation.</p>
        )}

        {assignStatus === "done" ? (
          <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" />
            Assigned
          </p>
        ) : targetProjectId ? (
          <Button size="sm" className="w-full" disabled={assignStatus === "loading"} onClick={() => assignTo(targetProjectId)}>
            {assignStatus === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
            Add to this project
          </Button>
        ) : assignOpen ? (
          <div className="flex gap-2">
            <Select value={pickerProjectId} onValueChange={setPickerProjectId}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" disabled={!pickerProjectId || assignStatus === "loading"} onClick={() => assignTo(pickerProjectId)}>
              {assignStatus === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setAssignOpen(true)} disabled={projects.length === 0}>
            <Clapperboard className="h-4 w-4" />
            {projects.length === 0 ? "Create a project first" : "Assign to project"}
          </Button>
        )}
        {assignStatus === "error" && <p className="text-xs text-destructive">Couldn&rsquo;t assign this character.</p>}
      </CardContent>

      <Dialog open={videosOpen} onOpenChange={setVideosOpen}>
        <DialogContent className="max-w-lg">
          <CharacterVideos characterId={character.id} name={character.name} />
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function CharacterVideos({ characterId, name }: { characterId: string; name: string }) {
  const [state, setState] = useState<{ status: "loading" | "done"; videos: { _id: string; url: string; projectId?: { title?: string } }[] }>({
    status: "loading",
    videos: [],
  });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/characters/${characterId}/videos`)
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled) setState({ status: "done", videos: body.videos ?? [] });
      });
    return () => {
      cancelled = true;
    };
  }, [characterId]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>{name}&rsquo;s videos</DialogTitle>
        <DialogDescription>Every finished video from a project this character appeared in.</DialogDescription>
      </DialogHeader>
      {state.status === "loading" ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : state.videos.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No finished videos yet.</p>
      ) : (
        <div className="space-y-2">
          {state.videos.map((v) => (
            <a
              key={v._id}
              href={v.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-lg border border-border p-2.5 text-sm hover:bg-accent"
            >
              <Video className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{v.projectId?.title ?? "Untitled project"}</span>
            </a>
          ))}
        </div>
      )}
    </>
  );
}

function CharacterForm({
  mode,
  character,
  onSuccess,
}: {
  mode: "create" | "edit";
  character?: LibraryCharacter;
  onSuccess: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [paletteText, setPaletteText] = useState((character?.colorPalette ?? []).join(", "));
  const [showHistory, setShowHistory] = useState(false);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { isSubmitting },
  } = useForm<CreateCharacterInput>({
    resolver: zodResolver(createCharacterSchema),
    defaultValues: character
      ? {
          name: character.name,
          role: character.role,
          ...character.spec,
          masterPrompt: character.masterPrompt,
          animationStyle: character.animationStyle,
        }
      : {},
  });
  const animationStyle = watch("animationStyle");

  async function onSubmit(values: CreateCharacterInput) {
    setServerError(null);
    const colorPalette = paletteText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const payload = { ...values, colorPalette };

    const res = await fetch(mode === "create" ? "/api/characters" : `/api/characters/${character!.id}`, {
      method: mode === "create" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setServerError(body.error ?? "Couldn't save this character. Please try again.");
      return;
    }
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <DialogHeader>
        <DialogTitle>{mode === "create" ? "New character" : `Edit ${character?.name}`}</DialogTitle>
        <DialogDescription>
          {mode === "create"
            ? "Define the character once. Assign it to a project afterward to generate its turnaround sheet."
            : "Editing spec, master prompt, style, palette, or voice records a new version — nothing already generated is lost."}
        </DialogDescription>
      </DialogHeader>

      <div className="mt-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" placeholder="e.g. Ravi" {...register("name")} />
          </div>
          {SPEC_FIELDS.map(({ key, label, placeholder }) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={key}>{label}</Label>
              <Input id={key} placeholder={placeholder} {...register(key)} />
            </div>
          ))}
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="personality">Personality</Label>
            <Input id="personality" placeholder="e.g. Curious and brave" {...register("personality")} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="masterPrompt">Master prompt</Label>
          <Textarea
            id="masterPrompt"
            placeholder="The exact, canonical description fed into every image/video/thumbnail prompt for this character. Leave blank to build it from the fields above."
            {...register("masterPrompt")}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="animationStyle">Animation style</Label>
            <Select value={animationStyle ?? ""} onValueChange={(v) => setValue("animationStyle", v)}>
              <SelectTrigger id="animationStyle">
                <SelectValue placeholder="Use project style" />
              </SelectTrigger>
              <SelectContent>
                {ANIMATION_STYLES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="colorPalette">Color palette</Label>
            <Input
              id="colorPalette"
              placeholder="#1B4965, #FFB703"
              value={paletteText}
              onChange={(e) => setPaletteText(e.target.value)}
            />
          </div>
        </div>

        {mode === "edit" && character && character.versionCount > 1 && (
          <div>
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <History className="h-3.5 w-3.5" />
              {showHistory ? "Hide" : "Show"} version history ({character.versionCount} versions)
            </button>
            {showHistory && (
              <p className="mt-2 rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
                This character has {character.versionCount} saved versions. Every edit to its spec, master prompt,
                style, palette, or voice keeps the prior version — nothing is overwritten silently.
              </p>
            )}
          </div>
        )}
      </div>

      {serverError && <p className="mt-3 text-sm text-destructive">{serverError}</p>}
      <DialogFooter className="mt-4">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === "create" ? "Create character" : "Save changes"}
        </Button>
      </DialogFooter>
    </form>
  );
}
