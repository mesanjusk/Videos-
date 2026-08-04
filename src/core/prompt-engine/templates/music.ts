import type { PromptTemplateDefinition } from "../types";

/**
 * PDF Step 8 — Music. No approved-stack (or free) generative-music API exists (Suno/Udio have no
 * public developer API as of writing), so this scope never drives an automatic provider call —
 * it only renders a copy-pasteable prompt shown next to the manual music upload
 * (`Project.musicAssetId`), the same way Google Flow's prompt is shown for video.
 */
export const musicTemplate: PromptTemplateDefinition = {
  scope: "music",
  name: "default-music",
  appendConsistencyFormula: false,
  variables: ["mood", "genre", "language"],
  template: `
Generate happy background music for a kids cartoon.
Mood: {{mood}}.
Genre: {{genre}}.
Language/region flavor: {{language}}.
Instrumental, no lyrics, loopable, upbeat, family-friendly.
`.trim(),
};
