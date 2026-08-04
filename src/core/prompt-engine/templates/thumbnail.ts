import type { PromptTemplateDefinition } from "../types";

/** PDF Step 10 — Thumbnail. */
export const thumbnailTemplate: PromptTemplateDefinition = {
  scope: "thumbnail",
  name: "default-thumbnail",
  appendConsistencyFormula: true,
  variables: ["style", "title", "aspectRatio"],
  template: `
Create a colorful {{style}}-style cartoon thumbnail for a video titled "{{title}}".

Large expressive characters.
Bright colors.
Exciting expressions.
Minimal background.
Large title space.
YouTube thumbnail.
Ultra detailed.
`.trim(),
};
