/**
 * Single source of truth for the marketing landing page's circular workflow wheel.
 *
 * The 8 steps below are a 1:1 grouping of the real pipeline already implemented in this codebase —
 * `JOB_TYPES` (src/modules/jobs/models/Job.ts), `PROJECT_STATUSES` (src/modules/projects/constants.ts),
 * prompt-template scopes (src/modules/prompt-templates/models/PromptTemplate.ts) and the AI provider
 * capabilities (src/core/ai/types.ts) — see ARCHITECTURE.md §§2,4,6,8 for the underlying pipeline this
 * mirrors. Nothing here is invented marketing copy disconnected from the product.
 *
 * Only `import type` is used for anything defined alongside a Mongoose model, so this file stays
 * server/client-safe and never drags Mongoose into the browser bundle (see the note atop
 * modules/projects/constants.ts for why that matters).
 */
import {
  BookText,
  Users,
  Mountain,
  ClipboardList,
  Clapperboard,
  Mic,
  Repeat,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import type { JobType } from "@/modules/jobs/models/Job";

export type WorkflowStepStatus = "completed" | "in_progress" | "ready" | "locked";

export interface WorkflowStep {
  id: string;
  order: number;
  title: string;
  shortLabel: string;
  tagline: string;
  description: string;
  checklist: string[];
  prompts: string[];
  resources: string[];
  icon: LucideIcon;
  /** Real job types from the queue system this step corresponds to. */
  jobTypes: JobType[];
  gradient: { from: string; to: string; glow: string };
}

export const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    id: "story",
    order: 0,
    title: "Idea & Script",
    shortLabel: "Story",
    tagline: "One premise becomes a full script",
    description:
      "Describe your idea in a sentence. The story engine writes a title, cast, and a scene-by-scene script — camera, dialogue, and emotion included — ready for every step after it.",
    checklist: ["Generate story idea", "Write engaging script", "Break into scenes", "Finalize dialogue"],
    prompts: ["A premise, target duration, language, and tone — rendered through the story prompt template"],
    resources: ["Prompt Library → story scope", "StoryJson schema (title, characters, scenes)"],
    icon: BookText,
    jobTypes: ["story"],
    gradient: { from: "#7c3aed", to: "#a855f7", glow: "rgba(168,85,247,0.55)" },
  },
  {
    id: "characters",
    order: 1,
    title: "Character Design",
    shortLabel: "Characters",
    tagline: "Consistent casts, generated once",
    description:
      "Every character gets a full spec — age, face, hair, clothes, personality — turned into a multi-pose reference sheet your whole video reuses, so the same face shows up in every scene.",
    checklist: ["Create unique characters", "Consistent look & style", "Multiple expressions", "Save character sheet"],
    prompts: ["Character Consistency Formula, auto-appended to every character/scene prompt"],
    resources: ["Prompt Library → character scope", "10 pose reference sheet per character"],
    icon: Users,
    jobTypes: ["character_image"],
    gradient: { from: "#2563eb", to: "#3b82f6", glow: "rgba(59,130,246,0.55)" },
  },
  {
    id: "backgrounds",
    order: 2,
    title: "Background Design",
    shortLabel: "Backgrounds",
    tagline: "Worlds that match every scene",
    description:
      "Generate reusable backgrounds — indoor, outdoor, fantasy, city — matched to your story's style and lighting, ready to drop behind any scene that needs them.",
    checklist: ["Design consistent backgrounds", "Match style & mood", "Save for all scenes"],
    prompts: ["Category, style, and lighting rendered through the background prompt template"],
    resources: ["Prompt Library → background scope"],
    icon: Mountain,
    jobTypes: ["background_image"],
    gradient: { from: "#0d9488", to: "#14b8a6", glow: "rgba(20,184,166,0.55)" },
  },
  {
    id: "scenes",
    order: 3,
    title: "Scene Planning",
    shortLabel: "Scenes",
    tagline: "Every shot, staged and framed",
    description:
      "Assign characters and backgrounds to each scene, set the action, camera angle, and emotion — then generate the still frame that anchors that scene's video clip.",
    checklist: ["Plan each scene", "Set actions & emotions", "Choose camera angles", "Create scene prompts"],
    prompts: ["Reference images + action/camera/emotion rendered through the scene-image template"],
    resources: ["Prompt Library → scene_image scope", "Scene status pipeline"],
    icon: ClipboardList,
    jobTypes: ["scene_image"],
    gradient: { from: "#16a34a", to: "#22c55e", glow: "rgba(34,197,94,0.55)" },
  },
  {
    id: "video",
    order: 4,
    title: "Video Generation",
    shortLabel: "Video",
    tagline: "Still frames become motion",
    description:
      "Each scene's frame becomes a short clip. Where no API exists yet, we hand you a ready-to-paste prompt for Google Flow and pick the render back up the moment you upload the result.",
    checklist: ["Generate video clips (5–8s)", "Maintain consistency", "Review & select best takes"],
    prompts: ["Action, camera, lighting, emotion rendered through the scene-video template"],
    resources: ["Manual hand-off flow for Google Flow", "Scene video status tracking"],
    icon: Clapperboard,
    jobTypes: ["scene_video"],
    gradient: { from: "#d97706", to: "#f59e0b", glow: "rgba(245,158,11,0.55)" },
  },
  {
    id: "voice",
    order: 5,
    title: "Voice & Dialogue",
    shortLabel: "Voice",
    tagline: "Every character, fully voiced",
    description:
      "Turn each line of dialogue into natural narration — matched to the character's tone, gender, and age — ready to sync against its scene's clip.",
    checklist: ["Generate realistic voice", "Match character tone", "Clear & expressive audio"],
    prompts: ["Dialogue text + character tone rendered through the voice template"],
    resources: ["Prompt Library → voice scope"],
    icon: Mic,
    jobTypes: ["voice"],
    gradient: { from: "#ea580c", to: "#fb923c", glow: "rgba(251,146,60,0.55)" },
  },
  {
    id: "lipsync",
    order: 6,
    title: "Lip Sync & Animation",
    shortLabel: "Lip Sync",
    tagline: "Voice and motion, perfectly aligned",
    description:
      "Upload a scene's clip and voice track together and get back a lip-synced version — reviewed and refined until the mouth movement matches the line.",
    checklist: ["Upload video + audio", "Auto lip sync", "Review & refine"],
    prompts: ["No prompt text — a direct video + audio hand-off"],
    resources: ["Manual lip-sync upload flow"],
    icon: Repeat,
    jobTypes: ["lipsync"],
    gradient: { from: "#db2777", to: "#ec4899", glow: "rgba(236,72,153,0.55)" },
  },
  {
    id: "edit",
    order: 7,
    title: "Edit & Finalize",
    shortLabel: "Finalize",
    tagline: "One polished, exportable video",
    description:
      "Scenes are stitched together with transitions, captions, and an optional music bed, then a thumbnail is generated — exported ready for upload.",
    checklist: ["Add music & SFX", "Transitions & effects", "Captions & zooms", "Export final video"],
    prompts: ["Title + style rendered through the thumbnail template", "Optional music prompt for a copy-paste generator"],
    resources: ["FFmpeg render pipeline (transitions, captions, mix)", "Prompt Library → thumbnail & music scopes"],
    icon: Wand2,
    jobTypes: ["render", "thumbnail"],
    gradient: { from: "#9333ea", to: "#c084fc", glow: "rgba(192,132,252,0.55)" },
  },
];

/** Real per-project counts the dashboard passes in — every field comes from an existing read-only service call. */
export interface WorkflowProgressCounts {
  hasStory: boolean;
  charactersCount: number;
  backgroundsCount: number;
  scenesCount: number;
  scenesWithImage: number;
  scenesWithVideo: number;
  scenesWithVoice: number;
  scenesWithLipSync: number;
  isDone: boolean;
}

const CHAIN_IDS = ["story", "characters", "backgrounds", "scenes", "video", "voice", "edit"] as const;

/**
 * Derives each step's status from the project's actual data — no fabricated progress. The 7-step
 * chain gates sequentially (a step can't be "in progress" until its prerequisite is complete); lip
 * sync is excluded from that chain because it's an optional hand-off (ARCHITECTURE.md §12) that never
 * blocks rendering.
 */
export function computeStepStatuses(counts: WorkflowProgressCounts): Record<string, WorkflowStepStatus> {
  const done: Record<(typeof CHAIN_IDS)[number], boolean> = {
    story: counts.hasStory,
    characters: counts.charactersCount > 0,
    backgrounds: counts.backgroundsCount > 0,
    scenes: counts.scenesCount > 0 && counts.scenesWithImage === counts.scenesCount,
    video: counts.scenesCount > 0 && counts.scenesWithVideo === counts.scenesCount,
    voice: counts.scenesCount > 0 && counts.scenesWithVoice === counts.scenesCount,
    edit: counts.isDone,
  };

  const result: Record<string, WorkflowStepStatus> = {};
  let prereqMet = true;
  let focusAssigned = false;
  for (const id of CHAIN_IDS) {
    if (done[id]) {
      result[id] = "completed";
    } else if (prereqMet && !focusAssigned) {
      result[id] = "in_progress";
      focusAssigned = true;
    } else if (prereqMet) {
      result[id] = "ready";
    } else {
      result[id] = "locked";
    }
    prereqMet = done[id];
  }

  const lipSyncEligible = done.video && done.voice;
  result.lipsync =
    counts.scenesCount > 0 && counts.scenesWithLipSync === counts.scenesCount
      ? "completed"
      : counts.scenesWithLipSync > 0
        ? "in_progress"
        : lipSyncEligible
          ? "ready"
          : "locked";

  return result;
}

/** Where a slice click should navigate — "story" lives on the project home page itself, so it scrolls instead. */
export function stepHref(stepId: string, projectId: string): string {
  switch (stepId) {
    case "story":
      return `/projects/${projectId}#story`;
    case "characters":
      return `/projects/${projectId}/characters`;
    case "backgrounds":
      return `/projects/${projectId}/backgrounds`;
    case "scenes":
    case "video":
    case "voice":
    case "lipsync":
      return `/projects/${projectId}/scenes`;
    case "edit":
      return `/projects/${projectId}/edit`;
    default:
      return `/projects/${projectId}`;
  }
}
