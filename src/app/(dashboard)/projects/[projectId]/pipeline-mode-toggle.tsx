"use client";

import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HelpButton } from "@/components/shared/help-button";

const MODES = [
  { value: "semi", label: "Semi-automation — I click each step" },
  { value: "full", label: "Full automation — auto-advance where possible" },
  { value: "manual", label: "Manual — I drive it from the Prompt Library" },
];

export function PipelineModeToggle({ projectId, pipelineMode }: { projectId: string; pipelineMode: string }) {
  const router = useRouter();

  async function save(value: string) {
    await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipelineMode: value }),
    });
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1.5">
      <Select defaultValue={pipelineMode} onValueChange={save}>
        <SelectTrigger className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MODES.map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <HelpButton
        text={
          "Semi-automation (default): every generation step waits for you to click it. Full automation: each step " +
          "auto-starts the next one the moment it can — story, characters, and backgrounds still need you to " +
          "describe them, and video/lip-sync still need a manual hand-off (no free API exists for either), but " +
          "everything else chains itself. Manual: same as semi-automation, but built around saving and reusing " +
          "named prompt presets in the Prompt Library instead of one-off edits."
        }
      />
    </div>
  );
}
