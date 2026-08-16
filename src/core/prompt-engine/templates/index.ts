import { storyTemplate } from "./story";
import { characterTemplate } from "./character";
import { backgroundTemplate } from "./background";
import { sceneImageTemplate } from "./scene-image";
import { sceneVideoTemplate } from "./scene-video";
import { voiceTemplate } from "./voice";
import { thumbnailTemplate } from "./thumbnail";
import { musicTemplate } from "./music";
import { instagramReplyTemplate } from "./instagram-reply";
import type { PromptTemplateDefinition } from "../types";

export {
  storyTemplate,
  characterTemplate,
  backgroundTemplate,
  sceneImageTemplate,
  sceneVideoTemplate,
  voiceTemplate,
  thumbnailTemplate,
  musicTemplate,
  instagramReplyTemplate,
};

/** All built-in defaults, seeded into `PromptTemplate` documents for a user on first use. */
export const defaultPromptTemplates: PromptTemplateDefinition[] = [
  storyTemplate,
  characterTemplate,
  backgroundTemplate,
  sceneImageTemplate,
  sceneVideoTemplate,
  voiceTemplate,
  thumbnailTemplate,
  musicTemplate,
  instagramReplyTemplate,
];
