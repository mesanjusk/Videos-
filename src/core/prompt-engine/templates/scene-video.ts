import type { PromptTemplateDefinition } from "../types";

/** PDF Step 5 — Generate Videos prompt formula, targeted at Google Flow's manual UI. */
export const sceneVideoTemplate: PromptTemplateDefinition = {
  scope: "scene_video",
  name: "default-scene-video",
  appendConsistencyFormula: false,
  variables: ["action", "camera", "lighting", "emotion", "durationSeconds", "style"],
  template: `
Use the attached character reference.

{{action}}
Camera: {{camera}}.
{{lighting}} lighting.
{{emotion}}.
{{style}}-quality 3D animation.
Ultra detailed.
Duration {{durationSeconds}} seconds.
`.trim(),
};
