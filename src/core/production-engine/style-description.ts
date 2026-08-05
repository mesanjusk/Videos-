import type { StylePackDoc } from "@/modules/style-packs/models/StylePack";

/**
 * Folds a StylePack's granular fields into one descriptive sentence, reused as
 * `Project.customStyleDescription` — the existing "Custom" style mechanism every image/video
 * processor's `style` prompt variable already reads (see gemini-image.ts / scene-image.processor.ts
 * etc.). This is the entire integration point: no processor needed a single line changed for style
 * packs to affect generation.
 */
export function composeStyleDescription(stylePack: Pick<StylePackDoc, "lighting" | "colorGrading" | "cameraStyle" | "composition" | "motionStyle" | "renderStyle">): string {
  const parts: string[] = [];
  if (stylePack.lighting) parts.push(`Lighting: ${stylePack.lighting}`);
  if (stylePack.colorGrading) parts.push(`Color grading: ${stylePack.colorGrading}`);
  if (stylePack.cameraStyle) parts.push(`Camera style: ${stylePack.cameraStyle}`);
  if (stylePack.composition) parts.push(`Composition: ${stylePack.composition}`);
  if (stylePack.motionStyle) parts.push(`Motion style: ${stylePack.motionStyle}`);
  if (stylePack.renderStyle) parts.push(`Render style: ${stylePack.renderStyle}`);
  return parts.join(". ");
}
