import type { UpdateSceneInput } from "./schema";

/**
 * Which generated assets go stale when a given Scene field is edited (ARCHITECTURE.md §5).
 * Field names here are `Scene` document fields, not prompt-template variable names — the two
 * don't line up 1:1 (e.g. `camera` becomes the scene-image template's `cameraAngle`), so this
 * mapping is kept explicit and scene-specific rather than derived generically from template
 * variable lists.
 */
type StaleFlag = "imageStale" | "videoStale" | "voiceStale" | "lipSyncStale";

// lipSyncStale piggybacks on video/voice: the lip-synced clip is derived from both, so anything
// that stales one of those (a re-shot clip, a re-recorded line) staled the merged clip too.
const FIELD_STALE_FLAGS: Record<keyof UpdateSceneInput, StaleFlag[]> = {
  visual: ["imageStale", "videoStale", "lipSyncStale"],
  camera: ["imageStale", "videoStale", "lipSyncStale"],
  emotion: ["imageStale", "videoStale", "lipSyncStale"],
  characterIds: ["imageStale", "videoStale", "lipSyncStale"],
  backgroundId: ["imageStale", "videoStale", "lipSyncStale"],
  dialogue: ["voiceStale", "lipSyncStale"],
};

/** Given the fields actually present in a scene update payload, which stale flags to set. */
export function staleFlagsForUpdate(input: UpdateSceneInput): Partial<Record<StaleFlag, true>> {
  const flags: Partial<Record<StaleFlag, true>> = {};
  for (const key of Object.keys(input) as (keyof UpdateSceneInput)[]) {
    for (const flag of FIELD_STALE_FLAGS[key] ?? []) {
      flags[flag] = true;
    }
  }
  return flags;
}
