import type { AiCapability, ImageProvider, ProviderDescriptor, StoryProvider, VideoProvider, VoiceProvider } from "./types";
import { GeminiStoryProvider } from "./providers/google/gemini-story";
import { GeminiImageProvider } from "./providers/google/gemini-image";
import { GeminiVoiceProvider } from "./providers/google/gemini-voice";
import { GoogleFlowVideoProvider } from "./providers/google/google-flow-video";

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
};

const videoProviders: Record<string, VideoProvider> = {
  "google-flow": new GoogleFlowVideoProvider(),
};

const voiceProviders: Record<string, VoiceProvider> = {
  gemini: new GeminiVoiceProvider(),
};

/** Providers registered but not yet enabled for selection — surfaced in Settings as "coming soon". */
export const FUTURE_PROVIDERS: ProviderDescriptor[] = [
  { id: "openai", label: "OpenAI", capability: "story", enabled: false },
  { id: "claude", label: "Anthropic Claude", capability: "story", enabled: false },
  { id: "flux", label: "FLUX", capability: "image", enabled: false },
  { id: "runway", label: "Runway", capability: "video", enabled: false },
  { id: "kling", label: "Kling", capability: "video", enabled: false },
  { id: "veo-vertex", label: "Veo (Vertex AI)", capability: "video", enabled: false },
  { id: "local", label: "Local model", capability: "image", enabled: false },
];

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
  }
}

export function getStoryProvider(providerId?: string): StoryProvider {
  const id = providerId ?? envDefault("story");
  const provider = storyProviders[id];
  if (!provider) throw new Error(`Unknown story provider "${id}"`);
  return provider;
}

export function getImageProvider(providerId?: string): ImageProvider {
  const id = providerId ?? envDefault("image");
  const provider = imageProviders[id];
  if (!provider) throw new Error(`Unknown image provider "${id}"`);
  return provider;
}

export function getVideoProvider(providerId?: string): VideoProvider {
  const id = providerId ?? envDefault("video");
  const provider = videoProviders[id];
  if (!provider) throw new Error(`Unknown video provider "${id}"`);
  return provider;
}

export function getVoiceProvider(providerId?: string): VoiceProvider {
  const id = providerId ?? envDefault("voice");
  const provider = voiceProviders[id];
  if (!provider) throw new Error(`Unknown voice provider "${id}"`);
  return provider;
}

export function listEnabledProviders(): ProviderDescriptor[] {
  return [
    ...Object.values(storyProviders).map((p) => ({ id: p.id, label: p.label, capability: "story" as const, enabled: true })),
    ...Object.values(imageProviders).map((p) => ({ id: p.id, label: p.label, capability: "image" as const, enabled: true })),
    ...Object.values(videoProviders).map((p) => ({ id: p.id, label: p.label, capability: "video" as const, enabled: true })),
    ...Object.values(voiceProviders).map((p) => ({ id: p.id, label: p.label, capability: "voice" as const, enabled: true })),
    ...FUTURE_PROVIDERS,
  ];
}
