"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProviderDescriptor, AiCapability } from "@/core/ai/types";

const CAPABILITIES: { key: AiCapability; label: string }[] = [
  { key: "story", label: "Story" },
  { key: "image", label: "Image (characters, backgrounds, scenes, thumbnail)" },
  { key: "video", label: "Video" },
  { key: "voice", label: "Voice" },
];

export function ProviderSettings({
  providers,
  overrides,
}: {
  providers: ProviderDescriptor[];
  overrides: Partial<Record<AiCapability, string>>;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState<AiCapability | null>(null);

  async function save(capability: AiCapability, providerId: string) {
    setSaving(capability);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability, providerId }),
    });
    setSaving(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {CAPABILITIES.map(({ key, label }) => {
        const enabled = providers.filter((p) => p.capability === key && p.enabled);
        const current = overrides[key] ?? enabled[0]?.id;
        return (
          <div key={key} className="flex items-center justify-between gap-4">
            <Label className="flex-1 text-sm font-normal">{label}</Label>
            <div className="flex items-center gap-2">
              {saving === key && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              <Select value={current} onValueChange={(v) => save(key, v)}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {enabled.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      })}
    </div>
  );
}
