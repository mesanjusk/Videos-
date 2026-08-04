/**
 * Constants shared between the client (project wizard, forms) and the server (Mongoose model,
 * Zod schemas). Deliberately has zero imports — importing anything from `mongoose` here (even
 * transitively, e.g. from `./models/Project`) would pull server-only/Node-only code into every
 * client bundle that needs these values, which silently breaks at runtime in the browser rather
 * than failing at build time (mongoose's browser behavior is undefined, not a hard error).
 */
export const PROJECT_STATUSES = [
  "draft",
  "story",
  "characters",
  "backgrounds",
  "scenes",
  "rendering",
  "done",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const VIDEO_STYLES = ["Pixar", "Disney", "Anime", "Realistic", "3D", "Custom"] as const;
