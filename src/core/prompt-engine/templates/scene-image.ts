import type { PromptTemplateDefinition } from "../types";

/** PDF Step 4 — Scene Prompt Formula: reference + background + action + camera + emotion + lighting + style. */
export const sceneImageTemplate: PromptTemplateDefinition = {
  scope: "scene_image",
  name: "default-scene-image",
  appendConsistencyFormula: true,
  variables: ["action", "cameraAngle", "emotion", "lighting", "style", "aspectRatio"],
  template: `
Using the attached character reference(s) and background reference, render this scene:

{{action}}
{{emotion}}.
{{cameraAngle}}.
{{lighting}} lighting.
{{style}}-quality 3D animation.
`.trim(),
};
