"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Clapperboard, Loader2, MoreVertical, Plus, Sparkles } from "lucide-react";
import {
  createProductionProfileSchema,
  generateFromProfileSchema,
  type CreateProductionProfileInput,
  type GenerateFromProfileInput,
} from "@/modules/production-profiles/schema";
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

const PROMPT_SCOPES = ["story", "character", "background", "scene_image", "scene_video", "voice", "thumbnail", "music"] as const;

export interface PickerCharacter {
  id: string;
  name: string;
}
export interface PickerPack {
  id: string;
  name: string;
}
export interface PickerTemplate {
  id: string;
  scope: string;
  name: string;
  isDefault: boolean;
}

export interface ProductionProfileItem extends CreateProductionProfileInput {
  id: string;
  version: number;
}

export function ProductionProfilesManager({
  profiles,
  characters,
  stylePacks,
  voicePacks,
  templates,
}: {
  profiles: ProductionProfileItem[];
  characters: PickerCharacter[];
  stylePacks: PickerPack[];
  voicePacks: PickerPack[];
  templates: PickerTemplate[];
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ProductionProfileItem | null>(null);
  const [generating, setGenerating] = useState<ProductionProfileItem | null>(null);

  async function remove(id: string) {
    if (!confirm("Delete this Production Profile? Projects already generated from it are unaffected.")) return;
    await fetch(`/api/production-profiles/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              New profile
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
            <ProductionProfileForm
              characters={characters}
              stylePacks={stylePacks}
              voicePacks={voicePacks}
              templates={templates}
              onSuccess={() => { setCreateOpen(false); router.refresh(); }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {profiles.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title="No Production Profiles yet"
          description="Bundle a cast, style, voice, and prompt presets into a reusable profile — then generate a whole project from just a topic."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Create your first profile
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {profiles.map((profile) => (
            <Card key={profile.id}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{profile.name}</p>
                    {profile.description && <p className="line-clamp-2 text-xs text-muted-foreground">{profile.description}</p>}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Profile actions">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing(profile)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onSelect={() => remove(profile.id)}>
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">{profile.status}</Badge>
                  <Badge variant="outline">v{profile.version}</Badge>
                  <Badge variant="outline">{profile.characterIds.length} character{profile.characterIds.length === 1 ? "" : "s"}</Badge>
                  <Badge variant="outline">{profile.defaultSceneCount} scenes</Badge>
                </div>
                <Button size="sm" className="w-full" onClick={() => setGenerating(profile)}>
                  <Sparkles className="h-4 w-4" />
                  Generate from this profile
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          {editing && (
            <ProductionProfileForm
              profile={editing}
              characters={characters}
              stylePacks={stylePacks}
              voicePacks={voicePacks}
              templates={templates}
              onSuccess={() => { setEditing(null); router.refresh(); }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!generating} onOpenChange={(open) => !open && setGenerating(null)}>
        <DialogContent>
          {generating && <GenerateForm profile={generating} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GenerateForm({ profile }: { profile: ProductionProfileItem }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<GenerateFromProfileInput>({ resolver: zodResolver(generateFromProfileSchema) });

  async function onSubmit(values: GenerateFromProfileInput) {
    setServerError(null);
    const res = await fetch(`/api/production-profiles/${profile.id}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setServerError(body.error ?? "Couldn't start generation.");
      return;
    }
    const { projectId } = await res.json();
    router.push(`/projects/${projectId}`);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <DialogHeader>
        <DialogTitle>Generate from &ldquo;{profile.name}&rdquo;</DialogTitle>
        <DialogDescription>
          Cast, style, voice, and prompt presets are already set by this profile. Just describe the topic.
        </DialogDescription>
      </DialogHeader>
      <div className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="topic">Topic</Label>
          <Textarea id="topic" rows={3} placeholder="e.g. Hanuman helps a village during a flood" {...register("topic")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notes">Notes (optional)</Label>
          <Textarea id="notes" rows={2} placeholder="Any extra direction for the story" {...register("notes")} />
        </div>
        {serverError && <p className="text-sm text-destructive">{serverError}</p>}
      </div>
      <DialogFooter className="mt-4">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Generate
        </Button>
      </DialogFooter>
    </form>
  );
}

function ProductionProfileForm({
  profile,
  characters,
  stylePacks,
  voicePacks,
  templates,
  onSuccess,
}: {
  profile?: ProductionProfileItem;
  characters: PickerCharacter[];
  stylePacks: PickerPack[];
  voicePacks: PickerPack[];
  templates: PickerTemplate[];
  onSuccess: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>(profile?.characterIds ?? []);
  const [templateByScope, setTemplateByScope] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const id of profile?.promptTemplateIds ?? []) {
      const t = templates.find((t) => t.id === id);
      if (t) initial[t.scope] = id;
    }
    return initial;
  });

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { isSubmitting },
  } = useForm<CreateProductionProfileInput>({
    resolver: zodResolver(createProductionProfileSchema),
    defaultValues: profile ?? {
      status: "active",
      language: "en",
      aspectRatio: "9:16",
      resolution: { width: 1080, height: 1920 },
      fps: 30,
      sceneDurationSeconds: 8,
      defaultSceneCount: 8,
      quality: {
        minResolutionWidth: 1080,
        minResolutionHeight: 1350,
        minSceneDurationSeconds: 5,
        maxSceneDurationSeconds: 8,
        characterConsistencyThreshold: 0.45,
        retryStrategy: "quality-triggered",
      },
      render: {
        oneSceneAtATime: true,
        maxParallelJobs: 2,
        retryDelaySeconds: 30,
        automaticContinuation: true,
        recoveryStrategy: "manual-handoff",
      },
    },
  });
  const stylePackId = watch("stylePackId");
  const voicePackId = watch("voicePackId");
  const retryStrategy = watch("quality.retryStrategy");
  const recoveryStrategy = watch("render.recoveryStrategy");
  const oneSceneAtATime = watch("render.oneSceneAtATime");
  const automaticContinuation = watch("render.automaticContinuation");

  function toggleCharacter(id: string) {
    setSelectedCharacterIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }

  async function onSubmit(values: CreateProductionProfileInput) {
    setServerError(null);
    const payload = {
      ...values,
      characterIds: selectedCharacterIds,
      promptTemplateIds: Object.values(templateByScope).filter(Boolean),
    };
    const res = await fetch(profile ? `/api/production-profiles/${profile.id}` : "/api/production-profiles", {
      method: profile ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setServerError(body.error ?? "Couldn't save this profile.");
      return;
    }
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <DialogHeader>
        <DialogTitle>{profile ? `Edit ${profile.name}` : "New Production Profile"}</DialogTitle>
        <DialogDescription>References your existing characters and prompt presets — nothing here is duplicated.</DialogDescription>
      </DialogHeader>

      <div className="mt-4 space-y-6">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" placeholder="e.g. Mythology Shorts" {...register("name")} />
          </div>
          <div className="col-span-2 space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={2} {...register("description")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category">Category</Label>
            <Input id="category" placeholder="e.g. Mythology" {...register("category")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="language">Language</Label>
            <Input id="language" placeholder="en" {...register("language")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aspectRatio">Aspect ratio</Label>
            <Input id="aspectRatio" placeholder="9:16" {...register("aspectRatio")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fps">FPS</Label>
            <Input id="fps" type="number" {...register("fps")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sceneDurationSeconds">Scene duration (s)</Label>
            <Input id="sceneDurationSeconds" type="number" {...register("sceneDurationSeconds")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="defaultSceneCount">Default scene count</Label>
            <Input id="defaultSceneCount" type="number" {...register("defaultSceneCount")} />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Characters</Label>
          {characters.length === 0 ? (
            <p className="text-xs text-muted-foreground">No characters in your library yet — add some on the Characters page first.</p>
          ) : (
            <div className="grid max-h-40 grid-cols-2 gap-2 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-3">
              {characters.map((c) => {
                const selected = selectedCharacterIds.includes(c.id);
                return (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => toggleCharacter(c.id)}
                    className={`flex items-center justify-between gap-1 rounded-md border px-2 py-1.5 text-left text-xs ${
                      selected ? "border-primary bg-primary/5" : "border-input hover:bg-accent"
                    }`}
                  >
                    <span className="truncate">{c.name}</span>
                    {selected && <Check className="h-3 w-3 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Style pack</Label>
            <Select value={stylePackId ?? "none"} onValueChange={(v) => setValue("stylePackId", v === "none" ? undefined : v)}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {stylePacks.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Voice pack</Label>
            <Select value={voicePackId ?? "none"} onValueChange={(v) => setValue("voicePackId", v === "none" ? undefined : v)}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {voicePacks.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Prompt presets per scope (optional — defaults to your active preset)</Label>
          <div className="grid grid-cols-2 gap-2">
            {PROMPT_SCOPES.map((scope) => {
              const scopeTemplates = templates.filter((t) => t.scope === scope);
              return (
                <div key={scope} className="space-y-1">
                  <Label className="text-xs capitalize text-muted-foreground">{scope.replace("_", " ")}</Label>
                  <Select
                    value={templateByScope[scope] ?? "default"}
                    onValueChange={(v) => setTemplateByScope((prev) => ({ ...prev, [scope]: v === "default" ? "" : v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Use active preset</SelectItem>
                      {scopeTemplates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-sm font-medium">Quality profile</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="quality.minResolutionWidth">Min width</Label>
              <Input id="quality.minResolutionWidth" type="number" {...register("quality.minResolutionWidth")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quality.minResolutionHeight">Min height</Label>
              <Input id="quality.minResolutionHeight" type="number" {...register("quality.minResolutionHeight")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quality.minSceneDurationSeconds">Min scene duration (s)</Label>
              <Input id="quality.minSceneDurationSeconds" type="number" {...register("quality.minSceneDurationSeconds")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quality.maxSceneDurationSeconds">Max scene duration (s)</Label>
              <Input id="quality.maxSceneDurationSeconds" type="number" {...register("quality.maxSceneDurationSeconds")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quality.characterConsistencyThreshold">Consistency threshold (0-1)</Label>
              <Input id="quality.characterConsistencyThreshold" type="number" step="0.05" min="0" max="1" {...register("quality.characterConsistencyThreshold")} />
            </div>
            <div className="space-y-1.5">
              <Label>Retry strategy</Label>
              <Select value={retryStrategy} onValueChange={(v) => setValue("quality.retryStrategy", v as CreateProductionProfileInput["quality"]["retryStrategy"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="quality-triggered">Quality-triggered</SelectItem>
                  <SelectItem value="aggressive">Aggressive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-sm font-medium">Render profile</p>
          <p className="text-xs text-muted-foreground">
            Configuration only — an abstraction layer for future rendering backends, not yet consumed by generation.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="render.maxParallelJobs">Max parallel jobs</Label>
              <Input id="render.maxParallelJobs" type="number" {...register("render.maxParallelJobs")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="render.retryDelaySeconds">Retry delay (s)</Label>
              <Input id="render.retryDelaySeconds" type="number" {...register("render.retryDelaySeconds")} />
            </div>
            <div className="space-y-1.5">
              <Label>Recovery strategy</Label>
              <Select value={recoveryStrategy} onValueChange={(v) => setValue("render.recoveryStrategy", v as CreateProductionProfileInput["render"]["recoveryStrategy"])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="retry">Retry</SelectItem>
                  <SelectItem value="manual-handoff">Manual hand-off</SelectItem>
                  <SelectItem value="skip">Skip</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-4 pt-5">
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={oneSceneAtATime}
                  onChange={(e) => setValue("render.oneSceneAtATime", e.target.checked)}
                />
                One scene at a time
              </label>
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={automaticContinuation}
                  onChange={(e) => setValue("render.automaticContinuation", e.target.checked)}
                />
                Auto-continue
              </label>
            </div>
          </div>
        </div>

        {serverError && <p className="text-sm text-destructive">{serverError}</p>}
      </div>

      <DialogFooter className="mt-4">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {profile ? "Save changes" : "Create profile"}
        </Button>
      </DialogFooter>
    </form>
  );
}
