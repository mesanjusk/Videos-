import { connectToDatabase } from "@/core/db/mongoose";
import { Character } from "@/modules/characters/models/Character";
import { Background } from "@/modules/backgrounds/models/Background";
import { enqueueJob } from "@/modules/jobs/service";
import type { GeneratedStory } from "@/core/ai/types";

/**
 * The cast and set that a fully-automatic production needs, derived from the story it just wrote.
 *
 * ## Why this exists
 *
 * `core/queue/orchestrator.ts#advanceScene` will not start a scene until it has both characters and
 * a background:
 *
 * ```ts
 * if (!scene.imageAssetId && scene.characterIds.length > 0 && scene.backgroundId) { …enqueue… }
 * ```
 *
 * and `onCharacterOrBackgroundReady` — the thing that assigns them — only runs *after* a
 * `character_image` or `background_image` job completes. Nothing enqueued those jobs. Before this
 * module, a project approved at `/create` wrote its story, created its scenes, and then stopped
 * dead: no character existed to generate a sheet for, so no assignment ever happened, so no scene
 * ever advanced. The auto-chain was only ever reachable by a human going to the Characters and
 * Backgrounds pages and pressing Generate. That is exactly the manual step this product is supposed
 * not to have.
 *
 * So: the story step now casts its own story. `GeneratedStory.characters` is `{ name, role }[]` and
 * the scenes carry `visual` descriptions — enough to create the Character and Background documents
 * the image providers already know how to render from.
 *
 * ## What it deliberately does not do
 *
 * It does not invent a detailed `spec` (age/face/hair/clothes). Those fields are optional in
 * `generateCharacterSheet`, and a guessed spec is worse than none: it silently overrides what the
 * model would otherwise infer from the character's name and role in a way the user never asked for
 * and can't see. `masterPrompt` carries the one thing we do know — who this character is in this
 * story — and a producer editing the character later fills in the rest.
 */

/** More than this and a "make me a video" turns into a long, expensive character-sheet run. */
const MAX_AUTO_CAST = 3;

export interface PlannedCharacter {
  name: string;
  role: string;
  masterPrompt: string;
}

export interface PlannedCast {
  characters: PlannedCharacter[];
  background: { name: string; description: string };
}

/**
 * The pure half: what to create, decided from the story alone. Split out from the database work
 * below so the casting rules — the cap, the de-duplication, how a background gets described — are
 * testable without a Mongo connection, which is the line `vitest.config.ts` draws.
 */
export function planAutoCast(story: GeneratedStory): PlannedCast {
  return {
    characters: dedupeByName(story.characters)
      .slice(0, MAX_AUTO_CAST)
      .map((member) => ({
        name: member.name.trim(),
        role: member.role?.trim() ?? "",
        masterPrompt: buildMasterPrompt(member, story),
      })),
    background: {
      name: story.title.trim().slice(0, 80) || "Main setting",
      description: buildBackgroundDescription(story),
    },
  };
}

export interface AutoCastResult {
  characterIds: string[];
  backgroundId: string | null;
  /** False when the project was already cast — this ran before, or a human set it up by hand. */
  created: boolean;
}

/**
 * Creates the missing Characters and Background for a project and enqueues their image jobs.
 *
 * Idempotent: if the project already has any character or background, that part is left alone. A
 * re-run of the story step (which replaces the scene plan) therefore reuses the existing cast
 * rather than generating a second set of sheets for the same people.
 */
export async function autoCastFromStory(
  userId: string,
  projectId: string,
  story: GeneratedStory,
  style: string,
): Promise<AutoCastResult> {
  await connectToDatabase();

  const [existingCharacters, existingBackground] = await Promise.all([
    Character.find({ userId, $or: [{ projectId }, { usedInProjectIds: projectId }] })
      .select("_id")
      .lean(),
    Background.findOne({ userId, projectId }).select("_id").lean(),
  ]);

  const characterIds = existingCharacters.map((c) => c._id.toString());
  let backgroundId = existingBackground?._id.toString() ?? null;
  let created = false;

  const planned = planAutoCast(story);

  if (characterIds.length === 0) {
    for (const member of planned.characters) {
      const character = await Character.create({
        userId,
        projectId,
        name: member.name,
        role: member.role,
        masterPrompt: member.masterPrompt,
      });
      characterIds.push(character._id.toString());
      await enqueueJob({
        userId,
        projectId,
        characterId: character._id.toString(),
        type: "character_image",
        // Only the poses the pipeline actually consumes downstream: scene images and the Flow video
        // hand-off both reference `front-view`. The full six-pose expression sheet is what the
        // Character Library generates when a person opens a character to work on it, and paying for
        // five extra images per character on every automatic run is not worth it.
        payload: { poses: ["front-view"], autoCast: true },
      });
    }
    created = created || characterIds.length > 0;
  }

  if (!backgroundId) {
    const background = await Background.create({
      userId,
      projectId,
      name: planned.background.name,
      category: "custom",
      description: planned.background.description,
      style, // `required` on the model; the image prompt itself reads the project's style at run time
      lighting: "morning",
    });
    backgroundId = background._id.toString();
    await enqueueJob({
      userId,
      projectId,
      type: "background_image",
      payload: { backgroundId, autoCast: true },
    });
    created = true;
  }

  return { characterIds, backgroundId, created };
}

function dedupeByName(characters: { name: string; role: string }[]) {
  const seen = new Set<string>();
  return characters.filter((c) => {
    const key = c.name.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildMasterPrompt(member: { name: string; role: string }, story: GeneratedStory) {
  const role = member.role?.trim();
  return role ? `${member.name} — ${role}. A character in "${story.title}".` : `${member.name}, a character in "${story.title}".`;
}

/**
 * One background per project, described from the story's own scene visuals.
 *
 * One, not one per scene, because `onCharacterOrBackgroundReady` assigns *the first ready
 * background* to every unassigned scene — generating six would cost six images and use one. Scene
 * variety comes from the per-scene image and video prompts, which carry each scene's own `visual`.
 */
function buildBackgroundDescription(story: GeneratedStory) {
  const visuals = story.scenes
    .slice(0, 3)
    .map((s) => s.visual?.trim())
    .filter(Boolean);
  if (visuals.length === 0) return `The main setting of "${story.title}".`;
  return `The main setting of "${story.title}": ${visuals.join(" ")}`.slice(0, 600);
}
