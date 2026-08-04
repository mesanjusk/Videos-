/**
 * Provider-agnostic contracts for every AI capability the studio uses.
 *
 * Nothing outside `src/core/ai` may import a vendor SDK (Google, OpenAI, etc.).
 * Services, queue processors, and routes only ever depend on these interfaces
 * plus `registry.ts` — adding a new provider means adding one file under
 * `providers/<vendor>/` and one line in the registry, never a change here.
 */
import type { PromptTemplateDefinition } from "@/core/prompt-engine/types";

/**
 * Every generation input below carries an optional `templateOverride` — the user's DB-edited
 * template for that scope (modules/prompt-templates), resolved by the queue processor and passed
 * through so each provider renders the user's version instead of its own hardcoded default when one
 * exists. This is what makes the Prompt Library's edits actually affect generation, not just display.
 */

// ── Shared ────────────────────────────────────────────────────────────────

/** Identifies which pooled generation account (see modules/accounts) performed a call. */
export interface GenerationAccountContext {
  googleAccountId?: string;
  accessToken?: string;
  apiKey?: string;
}

export class ProviderQuotaExceededError extends Error {
  constructor(
    public readonly providerId: string,
    public readonly retryAfterSeconds?: number,
  ) {
    super(`Provider "${providerId}" quota exceeded`);
    this.name = "ProviderQuotaExceededError";
  }
}

// ── Story ────────────────────────────────────────────────────────────────

export interface StoryScene {
  index: number;
  visual: string;
  dialogue: string;
  camera: string;
  emotion: string;
}

export interface GeneratedStory {
  title: string;
  language: string;
  characters: { name: string; role: string }[];
  scenes: StoryScene[];
  raw: string;
}

export interface StoryGenerationInput {
  premise: string;
  language: string;
  sceneCount: number;
  characterCount: number;
  tone?: string;
  targetDurationSeconds?: number;
  templateOverride?: PromptTemplateDefinition;
}

export interface StoryProvider {
  readonly id: string;
  readonly label: string;
  generateStory(input: StoryGenerationInput, account?: GenerationAccountContext): Promise<GeneratedStory>;
}

// ── Image ────────────────────────────────────────────────────────────────

export type CharacterPose =
  | "front-view"
  | "side-view"
  | "back-view"
  | "45-degree-view"
  | "happy"
  | "sad"
  | "angry"
  | "laughing"
  | "walking-pose"
  | "running-pose";

export interface CharacterSpec {
  name: string;
  age?: string;
  bodyType?: string;
  face?: string;
  eyes?: string;
  hair?: string;
  clothes?: string;
  shoes?: string;
  accessories?: string;
  personality?: string;
  style: string; // "Pixar" | "Disney" | "Anime" | "Realistic" | "3D" | custom
}

export interface GeneratedImage {
  /** Raw bytes/base64 or a provider-hosted URL — caller uploads to Cloudinary and discards this. */
  data: Buffer | string;
  mimeType: string;
  width: number;
  height: number;
}

export interface CharacterSheetInput {
  spec: CharacterSpec;
  poses: CharacterPose[];
  aspectRatio: "4:5";
  templateOverride?: PromptTemplateDefinition;
}

export interface BackgroundInput {
  description: string;
  category: string; // indoor | outdoor | forest | temple | city | village | beach | mountains | ...
  style: string;
  lighting: string;
  aspectRatio: "4:5";
  templateOverride?: PromptTemplateDefinition;
}

export interface SceneImageInput {
  characterReferenceImages: { url: string; description: string }[];
  backgroundReferenceUrl?: string;
  action: string;
  cameraAngle: string;
  emotion: string;
  lighting: string;
  style: string;
  aspectRatio: "4:5";
  templateOverride?: PromptTemplateDefinition;
}

export interface ThumbnailInput {
  title: string;
  characterReferenceImages: { url: string; description: string }[];
  style: string;
  description?: string;
  templateOverride?: PromptTemplateDefinition;
}

export interface ImageProvider {
  readonly id: string;
  readonly label: string;
  generateCharacterSheet(
    input: CharacterSheetInput,
    account?: GenerationAccountContext,
  ): Promise<Record<CharacterPose, GeneratedImage>>;
  generateBackground(input: BackgroundInput, account?: GenerationAccountContext): Promise<GeneratedImage>;
  generateSceneImage(input: SceneImageInput, account?: GenerationAccountContext): Promise<GeneratedImage>;
  generateThumbnail(input: ThumbnailInput, account?: GenerationAccountContext): Promise<GeneratedImage>;
}

// ── Video ────────────────────────────────────────────────────────────────

export interface VideoGenerationInput {
  sceneId: string;
  characterReferenceImages: { url: string; description: string }[];
  sceneImageUrl?: string;
  action: string;
  camera: string;
  lighting: string;
  emotion: string;
  durationSeconds: number; // clamp 5-8 per PDF pro-tip
  style: string;
  templateOverride?: PromptTemplateDefinition;
}

export type VideoGenerationResult =
  | { status: "completed"; data: Buffer | string; mimeType: string; durationSeconds: number }
  | {
      /** No public API exists for this provider (e.g. Google Flow) — a human must run the prompt manually. */
      status: "manual_pending";
      taskId: string;
      promptText: string;
      instructions: string;
    };

export interface VideoProvider {
  readonly id: string;
  readonly label: string;
  readonly requiresManualHandoff: boolean;
  generateVideo(input: VideoGenerationInput, account?: GenerationAccountContext): Promise<VideoGenerationResult>;
  /** Only implemented by manual-handoff providers; resolves a `manual_pending` task once the clip is uploaded. */
  completeManualUpload?(taskId: string, uploadedUrl: string): Promise<{ videoUrl: string; durationSeconds: number }>;
}

// ── Voice ────────────────────────────────────────────────────────────────

export interface VoiceGenerationInput {
  text: string;
  characterName?: string;
  gender?: "male" | "female" | "neutral";
  age?: number;
  tone?: string; // cheerful, energetic, funny, calm, ...
  templateOverride?: PromptTemplateDefinition;
}

export interface GeneratedVoice {
  data: Buffer | string;
  mimeType: string;
  durationSeconds?: number;
}

export interface VoiceProvider {
  readonly id: string;
  readonly label: string;
  generateVoice(input: VoiceGenerationInput, account?: GenerationAccountContext): Promise<GeneratedVoice>;
}

// ── Capability registry ─────────────────────────────────────────────────

export type AiCapability = "story" | "image" | "video" | "voice";

export interface ProviderDescriptor {
  id: string;
  label: string;
  capability: AiCapability;
  enabled: boolean;
}
