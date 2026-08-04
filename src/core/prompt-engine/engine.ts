import type { PromptContext, PromptTemplateDefinition } from "./types";
import { CHARACTER_CONSISTENCY_FORMULA } from "./consistency-formula";

/** Simple `{{variable}}` substitution — intentionally not a full templating language (see ARCHITECTURE.md §8). */
function substitute(template: string, context: PromptContext): string {
  return template.replace(/{{\s*([\w.]+)\s*}}/g, (match, key: string) => {
    const value = context[key];
    if (value === undefined) return match; // leave unresolved placeholders visible rather than silently dropping
    return value;
  });
}

export function renderTemplate(definition: PromptTemplateDefinition, context: PromptContext): string {
  const missing = definition.variables.filter((v) => !(v in context));
  if (missing.length > 0) {
    throw new Error(`Prompt template "${definition.name}" is missing variables: ${missing.join(", ")}`);
  }

  const body = substitute(definition.template, context);
  if (!definition.appendConsistencyFormula) return body.trim();

  const formula = substitute(CHARACTER_CONSISTENCY_FORMULA, {
    style: context.style ?? "Pixar",
    aspectRatio: context.aspectRatio ?? "1080x1350 (4:5)",
  });
  return `${body.trim()}\n\n${formula}`;
}

/** Given a set of changed field names, returns which template scopes must be regenerated (ARCHITECTURE.md §5). */
export function dependentScopes(
  templates: PromptTemplateDefinition[],
  changedFields: string[],
): PromptTemplateDefinition["scope"][] {
  const changed = new Set(changedFields);
  const scopes = new Set<PromptTemplateDefinition["scope"]>();
  for (const t of templates) {
    if (t.variables.some((v) => changed.has(v))) scopes.add(t.scope);
  }
  return [...scopes];
}
