import { Types, type HydratedDocument } from "mongoose";
import { connectToDatabase } from "@/core/db/mongoose";
import { Character, type CharacterDoc } from "./models/Character";
import { Asset } from "@/modules/assets/models/Asset";
import type { CreateCharacterInput, UpdateCharacterInput } from "./schema";

/** Fields that make up a character's creative identity — editing any of these snapshots the
 * pre-edit state into `previousVersions` first, so a producer can see/revert what changed. */
const VERSIONED_FIELDS = [
  "spec",
  "masterPrompt",
  "animationStyle",
  "colorPalette",
  "voiceProfile",
] as const;

export async function createCharacter(userId: string, input: CreateCharacterInput, projectId?: string) {
  await connectToDatabase();
  return Character.create({
    userId,
    projectId,
    name: input.name,
    role: input.role,
    masterPrompt: input.masterPrompt,
    animationStyle: input.animationStyle,
    colorPalette: input.colorPalette ?? [],
    spec: {
      age: input.age,
      bodyType: input.bodyType,
      face: input.face,
      eyes: input.eyes,
      hair: input.hair,
      clothes: input.clothes,
      shoes: input.shoes,
      accessories: input.accessories,
      personality: input.personality,
    },
  });
}

/** Characters usable in a given project — its own (`projectId`) plus any assigned in from the
 * library (`usedInProjectIds`), i.e. the full cast available to that project's Scene Manager. */
export async function listCharacters(userId: string, projectId: string) {
  await connectToDatabase();
  return Character.find({ userId, $or: [{ projectId }, { usedInProjectIds: projectId }] })
    .sort({ createdAt: 1 })
    .populate("sheetAssets.assetId")
    .lean();
}

export async function getCharacter(userId: string, characterId: string) {
  await connectToDatabase();
  return Character.findOne({ _id: characterId, userId }).lean();
}

export async function deleteCharacter(userId: string, characterId: string) {
  await connectToDatabase();
  await Character.deleteOne({ _id: characterId, userId });
}

/**
 * Applies a partial edit, snapshotting the pre-edit creative fields into `previousVersions` and
 * bumping `version` whenever one of VERSIONED_FIELDS actually changes — wires up the version-history
 * schema fields that previously existed but nothing ever wrote to.
 */
export async function updateCharacter(userId: string, characterId: string, patch: UpdateCharacterInput) {
  await connectToDatabase();
  const character = await Character.findOne({ _id: characterId, userId });
  if (!character) return null;

  const specKeys = ["age", "bodyType", "face", "eyes", "hair", "clothes", "shoes", "accessories", "personality"] as const;
  const hasSpecEdit = specKeys.some((key) => patch[key] !== undefined);
  const touchesVersionedField =
    hasSpecEdit || patch.masterPrompt !== undefined || patch.animationStyle !== undefined ||
    patch.colorPalette !== undefined || patch.voiceProfile !== undefined;

  if (touchesVersionedField) {
    const snapshot: Record<string, unknown> = { at: new Date(), version: character.version };
    for (const field of VERSIONED_FIELDS) snapshot[field] = character.get(field);
    character.previousVersions = [...(character.previousVersions ?? []), snapshot];
    character.version = (character.version ?? 1) + 1;
  }

  if (patch.name !== undefined) character.name = patch.name;
  if (patch.role !== undefined) character.role = patch.role;
  if (patch.masterPrompt !== undefined) character.masterPrompt = patch.masterPrompt;
  if (patch.animationStyle !== undefined) character.animationStyle = patch.animationStyle;
  if (patch.colorPalette !== undefined) character.colorPalette = patch.colorPalette;
  if (patch.voiceProfile !== undefined) character.voiceProfile = { ...character.voiceProfile, ...patch.voiceProfile };
  if (hasSpecEdit) {
    const nextSpec = { ...(character.spec ?? {}) };
    for (const key of specKeys) if (patch[key] !== undefined) nextSpec[key] = patch[key];
    character.spec = nextSpec;
  }

  await character.save();
  return character;
}

/**
 * Replaces a character's sheet with a single user-uploaded reference image, stored under the
 * "front-view" pose — the only pose every downstream consumer (scene image/video, thumbnail
 * processors) actually reads (see core/queue/processors/*.ts). Lets a user skip AI generation
 * entirely and supply their own character art.
 */
export async function setCharacterCustomImage(userId: string, characterId: string, assetId: string) {
  await connectToDatabase();
  return Character.findOneAndUpdate(
    { _id: characterId, userId },
    { $set: { sheetAssets: [{ pose: "front-view", assetId }] } },
    { new: true },
  );
}

/** Every character the user owns — the permanent Character Library, independent of any one project. */
export async function listCharacterLibrary(userId: string) {
  await connectToDatabase();
  return Character.find({ userId })
    .sort({ createdAt: -1 })
    .populate("sheetAssets.assetId")
    .populate("projectId", "title")
    .populate("usedInProjectIds", "title")
    .lean();
}

export type AssignCharacterResult =
  | { ok: true; character: HydratedDocument<CharacterDoc> }
  | { ok: false; error: "not_found" };

/**
 * True cross-project reuse: links an existing character into another project without copying the
 * document. One character, one identity, editable in one place — replaces the old clone-and-drift
 * behavior where "reuse" duplicated the character and the copies silently diverged.
 */
export async function assignCharacterToProject(
  userId: string,
  characterId: string,
  targetProjectId: string,
): Promise<AssignCharacterResult> {
  await connectToDatabase();
  const character = await Character.findOne({ _id: characterId, userId });
  if (!character) return { ok: false, error: "not_found" };

  const homeProjectId = character.projectId?.toString();
  if (!homeProjectId) {
    // A library-only character (created with no home project) adopts its first assignment as
    // home, unlocking image generation/upload — which need a project for style + storage. Every
    // project after that is additional reuse via usedInProjectIds.
    character.projectId = new Types.ObjectId(targetProjectId);
  } else if (homeProjectId !== targetProjectId) {
    const alreadyLinked = (character.usedInProjectIds ?? []).some((id) => id.toString() === targetProjectId);
    if (!alreadyLinked) character.usedInProjectIds = [...(character.usedInProjectIds ?? []), new Types.ObjectId(targetProjectId)];
  }

  await character.save();
  return { ok: true, character };
}

/** Videos from every project this character has appeared in (its home project + everywhere it was assigned) — the Character Library's "Previous Videos". */
export async function listCharacterVideos(userId: string, characterId: string) {
  await connectToDatabase();
  const character = await Character.findOne({ _id: characterId, userId }).select("projectId usedInProjectIds").lean();
  if (!character) return [];
  const projectIds = [character.projectId, ...(character.usedInProjectIds ?? [])].filter(Boolean);
  if (projectIds.length === 0) return [];
  return Asset.find({ userId, projectId: { $in: projectIds }, kind: "final_video" })
    .sort({ createdAt: -1 })
    .populate("projectId", "title")
    .lean();
}
