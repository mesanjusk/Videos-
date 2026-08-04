"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export interface PromptTemplateItem {
  id: string;
  scope: string;
  label: string;
  description: string;
  template: string;
  variables: string[];
}

export function PromptLibrary({ items }: { items: PromptTemplateItem[] }) {
  return (
    <div className="space-y-4">
      {items.map((item) => (
        <TemplateCard key={item.id} item={item} />
      ))}
    </div>
  );
}

function TemplateCard({ item }: { item: PromptTemplateItem }) {
  const router = useRouter();
  const [value, setValue] = useState(item.template);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const isDirty = value !== item.template;

  async function save() {
    setSaving(true);
    await fetch(`/api/prompt-templates/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: value }),
    });
    setSaving(false);
    router.refresh();
  }

  async function reset() {
    setResetting(true);
    const res = await fetch(`/api/prompt-templates/${item.id}/reset`, { method: "POST" });
    setResetting(false);
    if (res.ok) {
      const { template } = await res.json();
      setValue(template.template);
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{item.label}</CardTitle>
        <CardDescription>{item.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea rows={8} value={value} onChange={(e) => setValue(e.target.value)} className="font-mono text-xs" />
        {item.variables.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Variables:</span>
            {item.variables.map((v) => (
              <Badge key={v} variant="outline" className="font-mono">
                {`{{${v}}}`}
              </Badge>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={!isDirty || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={reset} disabled={resetting}>
            {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Reset to default
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
