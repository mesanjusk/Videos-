/**
 * What is happening to my video, right now, in words a person who has never heard of a render
 * queue can act on.
 *
 * ## Why this is separate from the stage/status fields that already exist
 *
 * There are three of them, and none of them answers this question. `Project.status`
 * ("scenes", "rendering") names a pipeline phase. `computePipelineStage` names an operations state
 * ("quality_check", "retry"). `Scene.status` names an asset's lifecycle
 * ("video_pending_manual"). Every one is written for someone who already knows how the machine
 * works, and the UI in front of a beginner had been rendering them raw.
 *
 * This maps all of it onto six things a video can be doing and two things that stop it, with the
 * one sentence that says what to do about each. Nothing here writes state — it derives, freshly,
 * from what the pipeline actually recorded, so it cannot drift out of sync with reality the way a
 * stored "current step" field would.
 *
 * The deliberate omission: no phase in here is named after the provider doing the work. "Making the
 * video" is true whether the clip came from an API, from browser automation driving Google Flow, or
 * from a person uploading it by hand — and which of those happened is not a thing the person who
 * typed one sentence should have to care about.
 */

export type ProgressPhase =
  | "writing" //   the story
  | "drawing" //   characters, background and the per-scene stills
  | "filming" //   the clips — the Google Flow step
  | "speaking" //  voice-over
  | "joining" //   the final render
  | "ready" //     done, there is a file to download
  | "waiting" //   blocked on a person
  | "problem"; //  blocked on a failure

export interface ProgressInput {
  projectStatus: string;
  hasFinalVideo: boolean;
  /** Every Scene's status for this project. */
  sceneStatuses: string[];
  /** Every Job's status for this project. */
  jobStatuses: string[];
  /** False when no Google account has a connected Flow session — the one setup step that blocks video. */
  canMakeVideo: boolean;
}

export interface ProgressReport {
  phase: ProgressPhase;
  /** Four words at most. This is the headline on the screen. */
  title: string;
  /** One sentence. Only says something when it changes what the person should do. */
  detail?: string;
  /** 0-100. Derived from real scene counts once there are scenes, not from a status lookup table. */
  percent: number;
  /** Scenes finished / total, for the dots the UI draws. Zero total before the story lands. */
  scenesDone: number;
  scenesTotal: number;
  /** True while the pipeline is moving on its own and the page should keep polling. */
  busy: boolean;
  /**
   * Set when a person has to do something. One button, never a list.
   *
   * `target` names a destination rather than a URL because the project's own id is not this
   * function's to know — the caller owns routing, and a href half-built here ("" to be filled in
   * later) is the kind of thing that ships as a dead link.
   */
  action?: { label: string; target: "accounts" | "project" | "retry" };
}

const FINISHED_SCENE_STATUSES = new Set(["video_ready", "voice_ready", "lipsync_ready", "complete"]);
const IMAGE_DONE_STATUSES = new Set([
  "image_ready",
  "video_pending_manual",
  "video_ready",
  "voice_queued",
  "voice_ready",
  "lipsync_pending_manual",
  "lipsync_ready",
  "complete",
]);

export function computeProgress(input: ProgressInput): ProgressReport {
  const scenesTotal = input.sceneStatuses.length;
  const scenesDone = input.sceneStatuses.filter((s) => FINISHED_SCENE_STATUSES.has(s)).length;
  const imagesDone = input.sceneStatuses.filter((s) => IMAGE_DONE_STATUSES.has(s)).length;
  const base = { scenesDone, scenesTotal };

  if (input.hasFinalVideo || input.projectStatus === "done") {
    return { ...base, phase: "ready", title: "Your video is ready", percent: 100, busy: false };
  }

  // A failure only stops the show when nothing else is still running. A single retrying job in a
  // ten-scene project is not something to alarm anyone about — the queue is already handling it.
  const anythingRunning = input.jobStatuses.some((s) => s === "queued" || s === "running" || s === "retrying");
  if (input.jobStatuses.includes("failed") && !anythingRunning) {
    return {
      ...base,
      phase: "problem",
      title: "Something went wrong",
      detail: "One step failed. Running it again is usually enough — the rest of your video is safe.",
      percent: percentFor(input, imagesDone, scenesDone),
      busy: false,
      action: { label: "Try again", target: "retry" },
    };
  }

  // The single setup step that blocks the video step, surfaced the moment it starts to matter
  // rather than after a scene has already parked itself on a human.
  const waitingOnAPerson = input.sceneStatuses.some((s) => s === "video_pending_manual" || s === "lipsync_pending_manual");
  if (waitingOnAPerson && !input.canMakeVideo) {
    return {
      ...base,
      phase: "waiting",
      title: "Connect Google Flow",
      detail: "Videos are made in Google Flow. Connect an account once and this finishes on its own from now on.",
      percent: percentFor(input, imagesDone, scenesDone),
      busy: false,
      action: { label: "Connect an account", target: "accounts" },
    };
  }
  if (waitingOnAPerson && !anythingRunning) {
    return {
      ...base,
      phase: "waiting",
      title: "Needs a hand",
      detail: "A clip could not be made automatically and is waiting for you to add it.",
      percent: percentFor(input, imagesDone, scenesDone),
      busy: false,
      action: { label: "See what's needed", target: "project" },
    };
  }

  const phase = livePhase(input, imagesDone, scenesDone, scenesTotal);
  return {
    ...base,
    phase,
    title: PHASE_TITLES[phase],
    detail: PHASE_DETAILS[phase],
    percent: percentFor(input, imagesDone, scenesDone),
    busy: true,
  };
}

function livePhase(input: ProgressInput, imagesDone: number, scenesDone: number, scenesTotal: number): ProgressPhase {
  if (input.projectStatus === "draft" || scenesTotal === 0) return "writing";
  if (input.projectStatus === "rendering") return "joining";
  if (scenesDone >= scenesTotal && scenesTotal > 0) return "joining";
  if (input.sceneStatuses.some((s) => s === "voice_queued" || s === "voice_ready")) return "speaking";
  if (imagesDone > 0) return "filming";
  // Scenes exist but no image has landed yet: either the cast is still being drawn, or the first
  // scene images are in flight. Both read as "drawing" to someone watching — the difference only
  // matters to the queue.
  return "drawing";
}

/**
 * Progress from work actually completed, once there is work to count.
 *
 * The old numbers came from a status lookup table, which meant an eight-scene project sat at "75%"
 * from the first finished scene to the last. Counting the real units — one point per scene image,
 * two per finished clip — makes the bar move every few minutes, which is the difference between a
 * page that looks alive and one that looks stuck.
 */
function percentFor(input: ProgressInput, imagesDone: number, scenesDone: number): number {
  if (input.hasFinalVideo) return 100;
  const scenesTotal = input.sceneStatuses.length;
  if (scenesTotal === 0) return input.projectStatus === "draft" ? 5 : 15;

  const STORY_SHARE = 15;
  const SCENE_SHARE = 70;
  const RENDER_SHARE = 15;

  const units = imagesDone + scenesDone * 2;
  const totalUnits = scenesTotal * 3;
  const scenePart = totalUnits === 0 ? 0 : (units / totalUnits) * SCENE_SHARE;
  const renderPart = input.projectStatus === "rendering" ? RENDER_SHARE / 2 : 0;

  return Math.min(99, Math.round(STORY_SHARE + scenePart + renderPart));
}

const PHASE_TITLES: Record<ProgressPhase, string> = {
  writing: "Writing the story",
  drawing: "Drawing the characters",
  filming: "Making the video",
  speaking: "Recording the voices",
  joining: "Putting it together",
  ready: "Your video is ready",
  waiting: "Needs a hand",
  problem: "Something went wrong",
};

const PHASE_DETAILS: Partial<Record<ProgressPhase, string>> = {
  filming: "Each scene becomes a short clip. This is the slowest part — a few minutes per scene.",
};
