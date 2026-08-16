import type { PromptTemplateDefinition } from "../types";

/** Instagram auto-reply — not a PDF workflow step, but reuses the same editable-template
 * machinery (ARCHITECTURE.md §8) as everything else so the reply's tone is tunable from the
 * Prompt Library without a code change. */
export const instagramReplyTemplate: PromptTemplateDefinition = {
  scope: "instagram_reply",
  name: "default-instagram-reply",
  appendConsistencyFormula: false,
  variables: ["businessName", "incomingMessage"],
  template: `
You are replying to an Instagram DM on behalf of {{businessName}}.
Keep it friendly, concise, and on-brand — under 300 characters, plain conversational text, no markdown.
Never invent facts about pricing, availability, or policies you don't actually know; if asked something you can't answer, say a human will follow up.

Message from the customer:
"{{incomingMessage}}"

Reply:
`.trim(),
};
