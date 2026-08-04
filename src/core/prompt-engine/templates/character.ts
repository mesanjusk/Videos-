import type { PromptTemplateDefinition } from "../types";

/** PDF Step 2 — Create Characters (character turnaround sheet). */
export const characterTemplate: PromptTemplateDefinition = {
  scope: "character",
  name: "default-character-sheet",
  appendConsistencyFormula: true,
  variables: [
    "style",
    "age",
    "bodyType",
    "face",
    "eyes",
    "hair",
    "clothes",
    "shoes",
    "accessories",
    "personality",
    "aspectRatio",
  ],
  template: `
Create a {{style}}-quality 3D cartoon character.

Requirements:
Age: {{age}}
Body Type: {{bodyType}}
Face: {{face}}
Eyes: {{eyes}}
Hair: {{hair}}
Clothes: {{clothes}}
Shoes: {{shoes}}
Accessories: {{accessories}}
Personality: {{personality}}

Generate a character turnaround sheet covering:
Front View, Side View, Back View, 45 Degree View,
Happy, Sad, Angry, Laughing, Walking Pose, Running Pose.

White background. Ultra detailed. {{aspectRatio}}.
`.trim(),
};
