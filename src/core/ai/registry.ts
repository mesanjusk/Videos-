import type {
  AiCapability,
  ImageProvider,
  LipSyncProvider,
  ProviderDescriptor,
  StoryProvider,
  VideoProvider,
  VoiceProvider,
} from "./types";
import { GeminiStoryProvider } from "./providers/google/gemini-story";
import { GeminiImageProvider } from "./providers/google/gemini-image";
import { GeminiVoiceProvider } from "./providers/google/gemini-voice";
import { GoogleFlowVideoProvider } from "./providers/google/google-flow-video";
import { ManualLipSyncProvider } from "./providers/manual/manual-lipsync";
import { VoiceboxProvider } from "./providers/voicebox/voicebox-voice";
import { IdeogramImageProvider } from "./providers/ideogram/ideogram-image";
import { LocalImageProvider } from "./providers/local/local-image";
import { listProviderMetadata, isProviderConfigured } from "./provider-metadata";

/**
 * The one and only place that knows concrete provider classes exist.
 *
 * To add a provider: implement the relevant interface under `providers/<vendor>/`, then add one
 * entry to the relevant map below with `enabled: false` until it's ready to ship. Nothing else in
 * the codebase changes.
 */
const storyProviders: Record<string, StoryProvider> = {
  gemini: new GeminiStoryProvider(),
};

const imageProviders: Record<string, ImageProvider> = {
  gemini: new GeminiImageProvider(),
  // Added by the merge. Both report themselves unavailable unless their flag is on and their
  // configuration is present, so registering them here changes nothing for a deployment that has
  // not opted in — see `assertUsable` below, which is what actually gates selection.
  ideogram: new IdeogramImageProvider(),
  "local-image": new LocalImageProvider(),
};

const videoProviders: Record<string, VideoProvider> = {
  "google-flow": new GoogleFlowVideoProvider(),
};

const voiceProviders: Record<string, VoiceProvider> = {
  gemini: new GeminiVoiceProvider(),
  voicebox: new VoiceboxProvider(),
};

const lipSyncProviders: Record<string, LipSyncProvider> = {
  manual: new ManualLipSyncProvider(),
};

/**
 * Providers registered but not yet enabled for selection — surfaced in Settings as "coming soon".
 * Every one of these needs a paid API key this deployment doesn't have configured; wiring the real
 * HTTP calls in is a one-file addition under `providers/<vendor>/` once that key exists (see
 * `ManualLipSyncProvider`/`GoogleFlowVideoProvider` for the shape a manual-handoff provider takes,
 * or `GeminiImageProvider` for a real synchronous one) — flip `enabled: true` here after.
 */
export const FUTURE_PROVIDERS: ProviderDescriptor[] = [
  { id: "openai", label: "OpenAI", capability: "story", enabled: false },
  { id: "claude", label: "Anthropic Claude", capability: "story", enabled: false },
  { id: "flux", label: "FLUX", capability: "image", enabled: false },
  { id: "runway", label: "Runway", capability: "video", enabled: false },
  { id: "kling", label: "Kling", capability: "video", enabled: false },
  { id: "veo-vertex", label: "Veo (Vertex AI)", capability: "video", enabled: false },
  { id: "hedra", label: "Hedra", capability: "lipsync", enabled: false },
  { id: "heygen", label: "HeyGen", capability: "lipsync", enabled: false },
];

/**
 * Providers added by the merge carry an `isAvailable()` of their own: a flag that is off, or a
 * missing URL or key, must make the provider unusable rather than make it throw halfway through a
 * job with a confusing message. This is the one place that check is enforced, so every getter
 * below gets it without repeating it.
 */
interface MaybeAvailable {
  isAvailable?: () => boolean;
}

function assertUsable<T extends { id: string; label: string }>(provider: T, capability: AiCapability): T {
  const check = (provider as T & MaybeAvailable).isAvailable;
  if (check && !check.call(provider)) {
    const descriptor = listProviderMetadata(capability).find((p) => p.id === provider.id);
    const missing = descriptor ? descriptor.requirements.filter((key) => !process.env[key]) : [];
    throw new Error(
      `Provider "${provider.id}" is not available for ${capability}. ` +
        (missing.length ? `Missing configuration: ${missing.join(", ")}. ` : "") +
        (descriptor?.flag ? `Check that its feature flag is enabled. ` : "") +
        `Choose a different ${capability} provider, or configure this one.`,
    );
  }
  return provider;
}

/** Providers that are registered, flagged on, and configured — what Settings should offer. */
export function listAvailableProviders(): ProviderDescriptor[] {
  return listProviderMetadata()
    .filter((descriptor) => isProviderConfigured(descriptor))
    .map((descriptor) => ({
      id: descriptor.id,
      label: descriptor.label,
      capability: descriptor.capability as AiCapability,
      enabled: true,
    }));
}

function envDefault(capability: AiCapability): string {
  switch (capability) {
    case "story":
      return process.env.AI_STORY_PROVIDER ?? "gemini";
    case "image":
      return process.env.AI_IMAGE_PROVIDER ?? "gemini";
    case "video":
      return process.env.AI_VIDEO_PROVIDER ?? "google-flow";
    case "voice":
      return process.env.AI_VOICE_PROVIDER ?? "gemini";
    case "lipsync":
      return process.env.AI_LIPSYNC_PROVIDER ?? "manual";
  }
}

export function getStoryProvider(providerId?: string): StoryProvider {
  const id = providerId ?? envDefault("story");
  const provider = storyProviders[id];
  if (!provider) throw new Error(`Unknown story provider "${id}"`);
  return assertUsable(provider, "story");
}

export function getImageProvider(providerId?: string): ImageProvider {
  const id = providerId ?? envDefault("image");
  const provider = imageProviders[id];
  if (!provider) throw new Error(`Unknown image provider "${id}"`);
  return assertUsable(provider, "image");
}

export function getVideoProvider(providerId?: string): VideoProvider {
  const id = providerId ?? envDefault("video");
  const provider = videoProviders[id];
  if (!provider) throw new Error(`Unknown video provider "${id}"`);
  return assertUsable(provider, "video");
}

export function getVoiceProvider(providerId?: string): VoiceProvider {
  const id = providerId ?? envDefault("voice");
  const provider = voiceProviders[id];
  if (!provider) throw new Error(`Unknown voice provider "${id}"`);
  return assertUsable(provider, "voice");
}

export function getLipSyncProvider(providerId?: string): LipSyncProvider {
  const id = providerId ?? envDefault("lipsync");
  const provider = lipSyncProviders[id];
  if (!provider) throw new Error(`Unknown lip-sync provider "${id}"`);
  return assertUsable(provider, "lipsync");
}

export function listEnabledProviders(): ProviderDescriptor[] {
  return [
    ...Object.values(storyProviders).map((p) => ({ id: p.id, label: p.label, capability: "story" as const, enabled: true })),
    ...Object.values(imageProviders).map((p) => ({ id: p.id, label: p.label, capability: "image" as const, enabled: true })),
    ...Object.values(videoProviders).map((p) => ({ id: p.id, label: p.label, capability: "video" as const, enabled: true })),
    ...Object.values(voiceProviders).map((p) => ({ id: p.id, label: p.label, capability: "voice" as const, enabled: true })),
    ...Object.values(lipSyncProviders).map((p) => ({ id: p.id, label: p.label, capability: "lipsync" as const, enabled: true })),
    ...FUTURE_PROVIDERS,
  ];
}
