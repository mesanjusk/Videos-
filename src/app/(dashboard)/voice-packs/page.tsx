import { requireUserId } from "@/core/auth/session";
import { listVoicePacks } from "@/modules/voice-packs/service";
import { HelpButton } from "@/components/shared/help-button";
import { VoicePacksManager, type VoicePackItem } from "./voice-packs-manager";

export default async function VoicePacksPage() {
  const userId = await requireUserId();
  const packs = await listVoicePacks(userId);

  const items: VoicePackItem[] = packs.map((p) => ({
    id: p._id.toString(),
    name: p.name,
    gender: p.gender ?? "narrator",
    language: p.language ?? "en",
    speakingSpeed: p.speakingSpeed ?? 1,
    emotion: p.emotion ?? undefined,
  }));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Voice Packs</h1>
        <HelpButton text="A reusable, named voice default — gender, language, speaking speed, emotion. Production Profiles reference a voice pack as a fallback; a character's own voice profile always wins when set." />
      </div>
      <p className="text-sm text-muted-foreground">Reusable voice defaults for Production Profiles.</p>
      <VoicePacksManager packs={items} />
    </div>
  );
}
