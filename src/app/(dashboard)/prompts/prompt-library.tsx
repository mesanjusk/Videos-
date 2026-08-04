"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus, RotateCcw, Save, Star, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface PromptPreset {
  id: string;
  name: string;
  template: string;
  variables: string[];
  isDefault: boolean;
}

export interface PromptScopeGroup {
  scope: string;
  label: string;
  description: string;
  presets: PromptPreset[];
}

export function PromptLibrary({ groups }: { groups: PromptScopeGroup[] }) {
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <ScopeSection key={group.scope} group={group} />
      ))}
    </div>
  );
}

function ScopeSection({ group }: { group: PromptScopeGroup }) {
  const router = useRouter();
  const active = group.presets.find((p) => p.isDefault) ?? group.presets[0]!;
  const [selectedId, setSelectedId] = useState(active.id);
  const selected = group.presets.find((p) => p.id === selectedId) ?? active;

  const [value, setValue] = useState(selected.template);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [activating, setActivating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const isDirty = value !== selected.template;

  function selectPreset(id: string) {
    const preset = group.presets.find((p) => p.id === id);
    if (!preset) return;
    setSelectedId(id);
    setValue(preset.template);
  }

  async function save() {
    setSaving(true);
    await fetch(`/api/prompt-templates/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: value }),
    });
    setSaving(false);
    router.refresh();
  }

  async function reset() {
    setResetting(true);
    const res = await fetch(`/api/prompt-templates/${selected.id}/reset`, { method: "POST" });
    setResetting(false);
    if (res.ok) {
      const { template } = await res.json();
      setValue(template.template);
      router.refresh();
    }
  }

  async function activate() {
    setActivating(true);
    await fetch(`/api/prompt-templates/${selected.id}/activate`, { method: "POST" });
    setActivating(false);
    router.refresh();
  }

  async function remove() {
    setDeleting(true);
    const res = await fetch(`/api/prompt-templates/${selected.id}`, { method: "DELETE" });
    setDeleting(false);
    if (res.ok) {
      setSelectedId(active.id === selected.id ? group.presets[0]!.id : active.id);
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle>{group.label}</CardTitle>
            <CardDescription>{group.description}</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => setSaveAsOpen(true)}>
            <Plus className="h-4 w-4" />
            Save as new preset
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {group.presets.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {group.presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => selectPreset(p.id)}
                className={
                  "flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors " +
                  (p.id === selected.id ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground")
                }
              >
                {p.isDefault && <Star className="h-3 w-3 fill-current" />}
                {p.name}
              </button>
            ))}
          </div>
        )}
        <Textarea rows={8} value={value} onChange={(e) => setValue(e.target.value)} className="font-mono text-xs" />
        {selected.variables.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Variables:</span>
            {selected.variables.map((v) => (
              <Badge key={v} variant="outline" className="font-mono">
                {`{{${v}}}`}
              </Badge>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={save} disabled={!isDirty || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={reset} disabled={resetting}>
            {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Reset to default
          </Button>
          {!selected.isDefault && (
            <Button size="sm" variant="outline" onClick={activate} disabled={activating}>
              {activating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Use this preset
            </Button>
          )}
          {!selected.isDefault && group.presets.length > 1 && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={remove} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete
            </Button>
          )}
        </div>
        {selected.isDefault && <p className="text-xs text-muted-foreground">Active — used the next time this step runs.</p>}
      </CardContent>
      <SaveAsDialog
        open={saveAsOpen}
        onOpenChange={setSaveAsOpen}
        scope={group.scope}
        template={value}
        existingNames={group.presets.map((p) => p.name)}
      />
    </Card>
  );
}

function SaveAsDialog({
  open,
  onOpenChange,
  scope,
  template,
  existingNames,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: string;
  template: string;
  existingNames: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return;
    if (existingNames.includes(name.trim())) {
      setError("You already have a preset with this name in this step.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/prompt-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, name: name.trim(), template }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Couldn't save this preset. Try a different name.");
      return;
    }
    setName("");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as new preset</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <label className="text-xs font-medium text-muted-foreground">Preset name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Hero, Villain, Fast-paced narration"
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim() || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save preset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
