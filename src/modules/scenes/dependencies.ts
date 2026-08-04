import type { UpdateSceneInput } from "./schema";

/**
 * Which generated assets go stale when a given Scene field is edited (ARCHITECTURE.md §5).
 * Field names here are `Scene` document fields, not prompt-template variable names — the two
 * don't line up 1:1 (e.g. `camera` becomes the scene-image template's `cameraAngle`), so this
 * mapping is kept explicit and scene-specific rather than derived generically from template
 * variable lists.
 */
const FIELD_STALE_FLAGS: Record<keyof UpdateSceneInput, ("imageStale" | "videoStale" | "voiceStale")[]> = {
  camera: ["imageStale", "videoStale"],
  emotion: ["imageStale", "videoStale"],
  characterIds: ["imageStale", "videoStale"],
  backgroundId: ["imageStale", "videoStale"],
  dialogue: ["voiceStale"],
};

/** Given the fields actually present in a scene update payload, which stale flags to set. */
export function staleFlagsForUpdate(input: UpdateSceneInput): Partial<Record<"imageStale" | "videoStale" | "voiceStale", true>> {
  const flags: Partial<Record<"imageStale" | "videoStale" | "voiceStale", true>> = {};
  for (const key of Object.keys(input) as (keyof UpdateSceneInput)[]) {
    for (const flag of FIELD_STALE_FLAGS[key] ?? []) {
      flags[flag] = true;
    }
  }
  return flags;
}
