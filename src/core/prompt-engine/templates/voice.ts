import type { PromptTemplateDefinition } from "../types";

/** PDF Step 6 — Voice. */
export const voiceTemplate: PromptTemplateDefinition = {
  scope: "voice",
  name: "default-voice",
  appendConsistencyFormula: false,
  variables: ["gender", "age", "tone", "text"],
  template: `
Generate a cheerful cartoon voice.
{{gender}}. Age {{age}}. {{tone}}.
Natural pacing. Expressive emotions.
Output high-quality dialogue audio for the line:
"{{text}}"
`.trim(),
};
