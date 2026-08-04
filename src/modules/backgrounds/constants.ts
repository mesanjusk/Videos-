/**
 * See src/modules/projects/constants.ts for why this file has zero imports: it's consumed by both
 * client components and the Mongoose model, and must never pull `mongoose` into a browser bundle.
 */
export const BACKGROUND_CATEGORIES = [
  "indoor",
  "outdoor",
  "forest",
  "temple",
  "city",
  "village",
  "beach",
  "mountains",
  "custom",
] as const;
