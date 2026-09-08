import type { BackgroundInput, CharacterPose, CharacterSheetInput, SceneImageInput, ThumbnailInput } from "../types";
import { renderTemplate } from "@/core/prompt-engine/engine";
import { backgroundTemplate, characterTemplate, sceneImageTemplate, thumbnailTemplate } from "@/core/prompt-engine/templates";

/**
 * How a structured image request becomes the sentence a generator is given.
 *
 * Lifted out of `GeminiImageProvider` when a second route — Google Flow, driven through a browser —
 * needed the same prompts. Two copies of this would drift the moment anyone edited one template,
 * and the drift would show up as "the browser route draws different pictures", which is a horrible
 * thing to debug. So there is one copy, and the provider that renders it is not the owner of it.
 *
 * The per-user prompt-template override still wins here, exactly as it did inside the provider:
 * a template is the user's setting, not the vendor's.
 */

export const DEFAULT_POSES: CharacterPose[] = [
  "front-view",
  "side-view",
  "back-view",
  "45-degree-view",
  "happy",
  "sad",
  "angry",
  "laughing",
  "walking-pose",
  "running-pose",
];

export function backgroundPrompt(input: BackgroundInput): string {
  return renderTemplate(input.templateOverride ?? backgroundTemplate, {
    description: input.description,
    style: input.style,
    lighting: input.lighting,
    aspectRatio: input.aspectRatio,
  });
}

export function characterBasePrompt(input: CharacterSheetInput): string {
  return renderTemplate(input.templateOverride ?? characterTemplate, {
    style: input.spec.style,
    age: input.spec.age ?? "",
    bodyType: input.spec.bodyType ?? "",
    face: input.spec.face ?? "",
    eyes: input.spec.eyes ?? "",
    hair: input.spec.hair ?? "",
    clothes: input.spec.clothes ?? "",
    shoes: input.spec.shoes ?? "",
    accessories: input.spec.accessories ?? "",
    personality: input.spec.personality ?? "",
    aspectRatio: input.aspectRatio,
  });
}

/** One pose off the shared base description — the sheet is one character seen ten ways, not ten characters. */
export function posePrompt(basePrompt: string, pose: CharacterPose): string {
  return `${basePrompt}\n\nPose for this image: ${pose.replace(/-/g, " ")}.`;
}

export function sceneImagePrompt(input: SceneImageInput): string {
  return renderTemplate(input.templateOverride ?? sceneImageTemplate, {
    action: input.action,
    cameraAngle: input.cameraAngle,
    emotion: input.emotion,
    lighting: input.lighting,
    style: input.style,
    aspectRatio: input.aspectRatio,
  });
}

/** The references a scene image is drawn against: its cast first, then where it happens. */
export function sceneImageReferences(input: SceneImageInput): string[] {
  return [
    ...input.characterReferenceImages.map((r) => r.url),
    ...(input.backgroundReferenceUrl ? [input.backgroundReferenceUrl] : []),
  ];
}

/** The aspect ratio is fixed rather than taken from the input: a thumbnail for this studio is a reel cover. */
export function thumbnailPrompt(input: ThumbnailInput): string {
  return renderTemplate(input.templateOverride ?? thumbnailTemplate, {
    style: input.style,
    title: input.title,
    aspectRatio: "1080x1920 (9:16)",
  });
}

/** A thumbnail is drawn against its cast, so the cover looks like the video it covers. */
export function thumbnailReferences(input: ThumbnailInput): string[] {
  return input.characterReferenceImages.map((r) => r.url);
}
