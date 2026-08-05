"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Mic2, MoreVertical, Plus } from "lucide-react";
import { createVoicePackSchema, type CreateVoicePackInput } from "@/modules/voice-packs/schema";
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
import { EmptyState } from "@/components/shared/empty-state";

export interface VoicePackItem {
  id: string;
  name: string;
  gender: "male" | "female" | "child" | "narrator";
  language: string;
  speakingSpeed: number;
  emotion?: string;
}

const GENDERS = ["male", "female", "child", "narrator"] as const;

export function VoicePacksManager({ packs }: { packs: VoicePackItem[] }) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<VoicePackItem | null>(null);

  async function remove(id: string) {
    if (!confirm("Delete this voice pack? Any profile referencing it will lose the reference.")) return;
    await fetch(`/api/voice-packs/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              New voice pack
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <VoicePackForm onSuccess={() => { setDialogOpen(false); router.refresh(); }} />
          </DialogContent>
        </Dialog>
      </div>

      {packs.length === 0 ? (
        <EmptyState
          icon={Mic2}
          title="No voice packs yet"
          description="Create a named voice default once and reuse it across every Production Profile."
          action={
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Create your first voice pack
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {packs.map((pack) => (
            <Card key={pack.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{pack.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge variant="outline">{pack.gender}</Badge>
                      <Badge variant="outline">{pack.language}</Badge>
                      <Badge variant="outline">{pack.speakingSpeed}x</Badge>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Voice pack actions">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing(pack)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onSelect={() => remove(pack.id)}>
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {pack.emotion && <p className="text-xs text-muted-foreground">Emotion: {pack.emotion}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-lg">
          {editing && <VoicePackForm pack={editing} onSuccess={() => { setEditing(null); router.refresh(); }} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VoicePackForm({ pack, onSuccess }: { pack?: VoicePackItem; onSuccess: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { isSubmitting },
  } = useForm<CreateVoicePackInput>({
    resolver: zodResolver(createVoicePackSchema),
    defaultValues: pack ?? { gender: "narrator", language: "en", speakingSpeed: 1 },
  });
  const gender = watch("gender");

  async function onSubmit(values: CreateVoicePackInput) {
    setServerError(null);
    const res = await fetch(pack ? `/api/voice-packs/${pack.id}` : "/api/voice-packs", {
      method: pack ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setServerError(body.error ?? "Couldn't save this voice pack.");
      return;
    }
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <DialogHeader>
        <DialogTitle>{pack ? `Edit ${pack.name}` : "New voice pack"}</DialogTitle>
        <DialogDescription>Reusable voice default — reference it from any Production Profile.</DialogDescription>
      </DialogHeader>
      <div className="mt-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input id="name" placeholder="e.g. Warm Narrator" {...register("name")} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Gender</Label>
            <Select value={gender} onValueChange={(v) => setValue("gender", v as CreateVoicePackInput["gender"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GENDERS.map((g) => (
                  <SelectItem key={g} value={g}>{g}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="language">Language</Label>
            <Input id="language" placeholder="en" {...register("language")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="speakingSpeed">Speaking speed</Label>
            <Input id="speakingSpeed" type="number" step="0.1" min="0.5" max="2" {...register("speakingSpeed")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="emotion">Emotion</Label>
            <Input id="emotion" placeholder="e.g. Warm, cheerful" {...register("emotion")} />
          </div>
        </div>
        {serverError && <p className="text-sm text-destructive">{serverError}</p>}
      </div>
      <DialogFooter className="mt-4">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {pack ? "Save changes" : "Create voice pack"}
        </Button>
      </DialogFooter>
    </form>
  );
}
