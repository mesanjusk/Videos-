export type PromptScope =
  | "story"
  | "character"
  | "background"
  | "scene_image"
  | "scene_video"
  | "voice"
  | "thumbnail"
  | "music";

/** A template string with `{{variable}}` placeholders, optionally including the shared consistency partial. */
export interface PromptTemplateDefinition {
  scope: PromptScope;
  name: string;
  /** Ordered list of variable names this template reads — drives selective re-generation (ARCHITECTURE.md §5). */
  variables: string[];
  /** Whether the PDF's "Character Consistency Formula" block is appended. */
  appendConsistencyFormula: boolean;
  template: string;
}

export type PromptContext = Record<string, string>;
