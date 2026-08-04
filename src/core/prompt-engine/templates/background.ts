import type { PromptTemplateDefinition } from "../types";

/** PDF Step 3 — Create Backgrounds. */
export const backgroundTemplate: PromptTemplateDefinition = {
  scope: "background",
  name: "default-background",
  appendConsistencyFormula: false,
  variables: ["description", "style", "lighting", "aspectRatio"],
  template: `
Create a colorful {{style}}-quality 3D cartoon scene: {{description}}.

{{lighting}} lighting.
No characters.
Bright colors.
Ultra detailed.
Same style for all future backgrounds in this project.
{{aspectRatio}} ratio.
`.trim(),
};
