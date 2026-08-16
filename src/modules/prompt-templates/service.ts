import { connectToDatabase } from "@/core/db/mongoose";
import { PromptTemplate } from "./models/PromptTemplate";
import { defaultPromptTemplates } from "@/core/prompt-engine/templates";
import type { PromptScope, PromptTemplateDefinition } from "@/core/prompt-engine/types";

const ALL_SCOPES: PromptScope[] = [
  "story",
  "character",
  "background",
  "scene_image",
  "scene_video",
  "voice",
  "thumbnail",
  "music",
  "instagram_reply",
];

function defaultFor(scope: PromptScope): PromptTemplateDefinition {
  const fallback = defaultPromptTemplates.find((t) => t.scope === scope);
  if (!fallback) throw new Error(`No default prompt template registered for scope "${scope}"`);
  return fallback;
}

/**
 * Ensures a user has an editable, DB-backed template for `scope` (seeded from the code default on
 * first access), and returns it. This is the single template used for generation in that scope —
 * "editable" per-scope, not a library of named variants, keeps the UI and the resolution logic simple.
 */
export async function getOrSeedTemplate(userId: string, scope: PromptScope) {
  await connectToDatabase();
  let doc = await PromptTemplate.findOne({ userId, scope, isDefault: true });
  if (!doc) {
    const fallback = defaultFor(scope);
    doc = await PromptTemplate.create({
      userId,
      scope,
      name: fallback.name,
      template: fallback.template,
      variables: fallback.variables,
      appendConsistencyFormula: fallback.appendConsistencyFormula,
      isDefault: true,
    });
  }
  return doc;
}

/**
 * Called by queue processors right before generation — the DB template if present, else the code
 * default. `overrideTemplateId` (a specific named preset's `_id`) lets a Production Profile
 * (Module 6) pin a project to a particular preset instead of whatever's currently `isDefault` for
 * that scope; every existing call site omits it, so behavior is unchanged unless a project sets
 * `Project.promptTemplateOverrides[scope]`.
 */
export async function resolveActiveTemplate(
  userId: string,
  scope: PromptScope,
  overrideTemplateId?: string,
): Promise<PromptTemplateDefinition> {
  if (overrideTemplateId) {
    const override = await PromptTemplate.findOne({ _id: overrideTemplateId, userId, scope }).lean();
    if (override) {
      return {
        scope: override.scope as PromptScope,
        name: override.name,
        template: override.template,
        variables: override.variables ?? [],
        appendConsistencyFormula: override.appendConsistencyFormula ?? false,
      };
    }
    // Falls through to the active/default template if the override id is stale (e.g. the preset
    // was deleted) rather than failing generation outright.
  }

  const doc = await getOrSeedTemplate(userId, scope);
  return {
    scope: doc.scope as PromptScope,
    name: doc.name,
    template: doc.template,
    variables: doc.variables ?? [],
    appendConsistencyFormula: doc.appendConsistencyFormula ?? false,
  };
}

/** Powers the Prompt Library page — every scope, seeding any that don't exist yet for this user. */
export async function listTemplatesForUser(userId: string) {
  await connectToDatabase();
  await Promise.all(ALL_SCOPES.map((scope) => getOrSeedTemplate(userId, scope)));
  return PromptTemplate.find({ userId }).sort({ scope: 1 }).lean();
}

export async function updateTemplateText(userId: string, templateId: string, template: string) {
  await connectToDatabase();
  return PromptTemplate.findOneAndUpdate({ _id: templateId, userId }, { $set: { template } }, { new: true }).lean();
}

export type CreateTemplateResult =
  | { ok: true; template: Awaited<ReturnType<typeof getOrSeedTemplate>> }
  | { ok: false; error: "duplicate_name" | "source_not_found" };

/**
 * Saves the current text of a scope as a new, separately-named, non-active preset — e.g. "Hero v2"
 * next to the scope's active "default-character" template. The unique `{userId, scope, name}` index
 * already supported a library of named presets per scope; this is the write path that was missing.
 */
export async function createNamedTemplate(
  userId: string,
  scope: PromptScope,
  name: string,
  template: string,
): Promise<CreateTemplateResult> {
  await connectToDatabase();
  const source = await getOrSeedTemplate(userId, scope);
  try {
    const doc = await PromptTemplate.create({
      userId,
      scope,
      name,
      template,
      variables: source.variables,
      appendConsistencyFormula: source.appendConsistencyFormula,
      isDefault: false,
    });
    return { ok: true, template: doc };
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code?: number }).code === 11000) {
      return { ok: false, error: "duplicate_name" };
    }
    throw err;
  }
}

/** Marks one named preset as the active one used for generation in its scope, demoting any other default. */
export async function activateTemplate(userId: string, templateId: string) {
  await connectToDatabase();
  const target = await PromptTemplate.findOne({ _id: templateId, userId });
  if (!target) return null;
  await PromptTemplate.updateMany({ userId, scope: target.scope, _id: { $ne: target._id } }, { $set: { isDefault: false } });
  target.isDefault = true;
  await target.save();
  return target;
}

export type DeleteTemplateResult = { ok: true } | { ok: false; error: "not_found" | "cannot_delete_active" };

/** The active (`isDefault`) preset in a scope can't be deleted — activate a different one first. */
export async function deleteTemplate(userId: string, templateId: string): Promise<DeleteTemplateResult> {
  await connectToDatabase();
  const doc = await PromptTemplate.findOne({ _id: templateId, userId });
  if (!doc) return { ok: false, error: "not_found" };
  if (doc.isDefault) return { ok: false, error: "cannot_delete_active" };
  await doc.deleteOne();
  return { ok: true };
}

/** Restores a template's text to the code-level default for its scope — the DB doc itself is kept, just its text reset. */
export async function resetTemplate(userId: string, templateId: string) {
  await connectToDatabase();
  const doc = await PromptTemplate.findOne({ _id: templateId, userId });
  if (!doc) return null;
  const fallback = defaultFor(doc.scope as PromptScope);
  doc.template = fallback.template;
  await doc.save();
  return doc;
}
