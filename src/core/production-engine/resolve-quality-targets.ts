import { ProductionProfile } from "@/modules/production-profiles/models/ProductionProfile";
import { TARGET_IMAGE_4_5, SCENE_VIDEO_DURATION } from "@/core/quality/checks";

export interface ResolvedQualityTargets {
  imageTarget: { width: number; height: number };
  sceneVideoDuration: { min: number; max: number };
  characterConsistencyThreshold: number;
}

const DEFAULT_CONSISTENCY_THRESHOLD = 0.45;

/**
 * Module 5's quality-check targets were hardcoded constants; this resolves them from the project's
 * Production Profile (Module 6) when one is set, falling back to those exact constants otherwise —
 * zero behavior change for any project not created from a profile. Called from the same processors
 * that already call core/quality/checks.ts, one extra lookup only when `activeProfileId` is set.
 */
export async function resolveQualityTargets(activeProfileId: unknown, userId: string): Promise<ResolvedQualityTargets> {
  const defaults: ResolvedQualityTargets = {
    imageTarget: TARGET_IMAGE_4_5,
    sceneVideoDuration: SCENE_VIDEO_DURATION,
    characterConsistencyThreshold: DEFAULT_CONSISTENCY_THRESHOLD,
  };
  if (!activeProfileId) return defaults;

  const profile = await ProductionProfile.findOne({ _id: activeProfileId, userId }).select("quality").lean();
  if (!profile?.quality) return defaults;

  return {
    imageTarget: { width: profile.quality.minResolutionWidth ?? defaults.imageTarget.width, height: profile.quality.minResolutionHeight ?? defaults.imageTarget.height },
    sceneVideoDuration: {
      min: profile.quality.minSceneDurationSeconds ?? defaults.sceneVideoDuration.min,
      max: profile.quality.maxSceneDurationSeconds ?? defaults.sceneVideoDuration.max,
    },
    characterConsistencyThreshold: profile.quality.characterConsistencyThreshold ?? defaults.characterConsistencyThreshold,
  };
}
