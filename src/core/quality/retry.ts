import type { QualityIssue } from "./types";
import type { ProductionStage } from "@/core/production/types";

/**
 * Which stage to re-run when a quality check fails.
 *
 * The rule the existing system already follows and this makes explicit: **retry the stage that
 * produced the fault, not the production.** Re-running a whole project because one scene came out
 * black throws away every other scene's generation — which is both the expensive thing and the
 * thing most likely to produce a *different* set of problems on the second attempt.
 *
 * Where a fault cannot be attributed to a stage, this returns null and the caller surfaces it to a
 * human rather than guessing. Guessing wrong here costs a full re-render.
 */

const CHECK_TO_STAGE: Record<string, ProductionStage> = {
  // Image faults come from image generation.
  resolution: "images",
  "character-consistency": "characters",

  // Video faults come from the clip, not the composition — a black clip was black before the
  // renderer ever saw it.
  "black-frames": "video",
  duration: "video",

  // Audio faults come from the voice stage.
  "audio-presence": "voice",
  "audio-duration": "voice",

  // These are composition-level: the inputs were fine and the render is what went wrong.
  "file-integrity": "render",
  "video-stream": "render",
  "frame-rate": "render",
  codec: "render",
  "caption-presence": "render",

  // Not a generation fault at all — something upstream lost or duplicated a scene. No amount of
  // re-running a generation stage fixes it.
  "scene-ordering": "storyboard",
};

export interface RetryDecision {
  /** The stage to re-run, or null when the fault is not attributable to one. */
  stage: ProductionStage | null;
  /** The issues that drove the decision. */
  issues: QualityIssue[];
  reason: string;
}

/**
 * Decides what, if anything, to re-run.
 *
 * Only `error`-severity issues trigger a retry. Warnings are recorded and shown — a frame rate a
 * little off, a slightly short clip, a subjective similarity score — because re-rendering for them
 * costs more than the defect does. That threshold is the same one the pre-merge system used and is
 * deliberately unchanged.
 */
export function decideRetry(issues: QualityIssue[]): RetryDecision {
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length === 0) {
    return { stage: null, issues, reason: "No error-severity issues — warnings are recorded, not retried." };
  }

  const stages = [...new Set(errors.map((issue) => CHECK_TO_STAGE[issue.check]).filter(Boolean))] as ProductionStage[];

  if (stages.length === 0) {
    return {
      stage: null,
      issues: errors,
      reason: `No stage owns ${errors.map((e) => e.check).join(", ")} — needs a human rather than a guess.`,
    };
  }

  // Several stages implicated: re-run the earliest, since a fault there plausibly caused the
  // later ones. Re-running the later stage first would just reproduce the same input.
  const order: ProductionStage[] = [
    "research", "factcheck", "script", "storyboard", "characters", "assets",
    "images", "video", "voice", "captions", "timeline", "render", "quality", "finalize",
  ];
  const earliest = stages.sort((a, b) => order.indexOf(a) - order.indexOf(b))[0]!;

  return {
    stage: earliest,
    issues: errors,
    reason:
      stages.length === 1
        ? `${errors.map((e) => e.check).join(", ")} is owned by the "${earliest}" stage.`
        : `Issues span ${stages.join(", ")}; re-running the earliest ("${earliest}") since a fault there likely caused the rest.`,
  };
}
