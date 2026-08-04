import type { PromptTemplateDefinition } from "../types";

/** PDF Step 1 — Write the Story. */
export const storyTemplate: PromptTemplateDefinition = {
  scope: "story",
  name: "default-story",
  appendConsistencyFormula: false,
  variables: ["premise", "language", "sceneCount", "characterCount", "tone", "targetDurationSeconds"],
  template: `
Act as a professional cartoon script writer.

Write a {{targetDurationSeconds}}-second {{tone}} cartoon story in {{language}} based on this idea:
"{{premise}}"

Requirements:
- {{sceneCount}} scenes
- {{characterCount}} main characters
- Funny dialogue
- Simple language
- Happy ending

Return strictly as JSON matching the given schema: a title, a list of characters (name, role), and a
list of scenes, each with index, visual, dialogue, camera, and emotion.
`.trim(),
};
