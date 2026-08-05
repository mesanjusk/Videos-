"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, MoreVertical, Palette, Plus } from "lucide-react";
import { createStylePackSchema, type CreateStylePackInput } from "@/modules/style-packs/schema";
import { VIDEO_STYLES } from "@/modules/projects/constants";
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

export interface StylePackItem {
  id: string;
  name: string;
  category: (typeof VIDEO_STYLES)[number];
  lighting?: string;
  colorGrading?: string;
  cameraStyle?: string;
  composition?: string;
  motionStyle?: string;
  renderStyle?: string;
}

const FIELDS: { key: keyof CreateStylePackInput; label: string; placeholder: string }[] = [
  { key: "lighting", label: "Lighting", placeholder: "e.g. Soft golden hour" },
  { key: "colorGrading", label: "Color grading", placeholder: "e.g. Warm, slightly desaturated" },
  { key: "cameraStyle", label: "Camera style", placeholder: "e.g. Handheld, dynamic angles" },
  { key: "composition", label: "Composition", placeholder: "e.g. Rule of thirds, wide establishing shots" },
  { key: "motionStyle", label: "Motion style", placeholder: "e.g. Smooth slow motion" },
  { key: "renderStyle", label: "Render style", placeholder: "e.g. Ultra-realistic 8K detail" },
];

export function StylePacksManager({ packs }: { packs: StylePackItem[] }) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<StylePackItem | null>(null);

  async function remove(id: string) {
    if (!confirm("Delete this style pack? Any profile referencing it will lose the reference.")) return;
    await fetch(`/api/style-packs/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              New style pack
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
            <StylePackForm onSuccess={() => { setDialogOpen(false); router.refresh(); }} />
          </DialogContent>
        </Dialog>
      </div>

      {packs.length === 0 ? (
        <EmptyState
          icon={Palette}
          title="No style packs yet"
          description="Create a named style once — lighting, color grading, camera style — and reuse it across every Production Profile."
          action={
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Create your first style pack
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
                    <Badge variant="outline" className="mt-1">{pack.category}</Badge>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Style pack actions">
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
                <p className="line-clamp-3 text-xs text-muted-foreground">
                  {[pack.lighting, pack.colorGrading, pack.cameraStyle].filter(Boolean).join(" · ") || "No details set"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          {editing && (
            <StylePackForm
              pack={editing}
              onSuccess={() => { setEditing(null); router.refresh(); }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StylePackForm({ pack, onSuccess }: { pack?: StylePackItem; onSuccess: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { isSubmitting },
  } = useForm<CreateStylePackInput>({
    resolver: zodResolver(createStylePackSchema),
    defaultValues: pack ?? { category: "Custom" },
  });
  const category = watch("category");

  async function onSubmit(values: CreateStylePackInput) {
    setServerError(null);
    const res = await fetch(pack ? `/api/style-packs/${pack.id}` : "/api/style-packs", {
      method: pack ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setServerError(body.error ?? "Couldn't save this style pack.");
      return;
    }
    onSuccess();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <DialogHeader>
        <DialogTitle>{pack ? `Edit ${pack.name}` : "New style pack"}</DialogTitle>
        <DialogDescription>Reusable visual style — reference it from any Production Profile.</DialogDescription>
      </DialogHeader>
      <div className="mt-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input id="name" placeholder="e.g. Ultra Realistic" {...register("name")} />
          </div>
          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={(v) => setValue("category", v as CreateStylePackInput["category"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VIDEO_STYLES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {FIELDS.map(({ key, label, placeholder }) => (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={key}>{label}</Label>
            <Input id={key} placeholder={placeholder} {...register(key)} />
          </div>
        ))}
        {serverError && <p className="text-sm text-destructive">{serverError}</p>}
      </div>
      <DialogFooter className="mt-4">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {pack ? "Save changes" : "Create style pack"}
        </Button>
      </DialogFooter>
    </form>
  );
}
