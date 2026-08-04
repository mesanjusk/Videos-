import { connectToDatabase } from "@/core/db/mongoose";
import { PromptTemplate } from "./models/PromptTemplate";
import { defaultPromptTemplates } from "@/core/prompt-engine/templates";
import type { PromptScope, PromptTemplateDefinition } from "@/core/prompt-engine/types";

const ALL_SCOPES: PromptScope[] = ["story", "character", "background", "scene_image", "scene_video", "voice", "thumbnail"];

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

/** Called by queue processors right before generation — the DB template if present, else the code default. */
export async function resolveActiveTemplate(userId: string, scope: PromptScope): Promise<PromptTemplateDefinition> {
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
