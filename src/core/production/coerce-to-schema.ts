import type { ZodTypeAny, ZodIssue } from "zod";

/**
 * Repairing a model's JSON against the schema that rejected it, using the rejection itself.
 *
 * A language model asked for `{"narration": true}` will sometimes answer `"yes"`, `8` where `"8"`
 * was wanted, a bare string where a list belongs. Zod rejects the whole object over any one of
 * them, and this codebase throws the plan away — a full generation wasted, on a free tier metered
 * per day, because a boolean arrived as the word for it.
 *
 * The first attempt at this fixed the two fields that had been *seen* failing: an asset kind and a
 * scene duration. That was the wrong shape of fix, and it did not survive contact — the next run
 * died on `voiceRequirements.narration: Expected boolean, received string`, a field nobody had
 * listed. Enumerating fields cannot work: the failures are drawn from every leaf of a large schema,
 * and the list is only ever complete for failures that have already happened.
 *
 * So this is driven by the schema instead. Parse, read what Zod says was wrong and where, repair
 * exactly those paths when the intent is unambiguous, and parse again. The schema stays the single
 * source of truth about shape; nothing here has to know that `narration` is a boolean, only that
 * something expected one and got the string "yes".
 *
 * ## What it will not do
 *
 * Guess. Every conversion here is one where the model's meaning is beyond doubt — "yes" for true,
 * "8 seconds" for 8, a lone item where a list was wanted. A string that is not a recognisable
 * boolean, or a number, or an enum member is left exactly as written so the parse still fails and
 * the failure is still visible. Silently coercing an unreadable value would replace a loud error
 * with a plan that quietly says something nobody asked for.
 */

export interface CoercionResult<T> {
  /** Parsed value when the (possibly repaired) input satisfies the schema. */
  data?: T;
  /** Human-readable note per repair, for the caller to surface. */
  notes: string[];
  /** The issues that remain unrepairable, when parsing still fails. */
  issues: ZodIssue[];
}

const TRUE_WORDS = new Set(["true", "yes", "y", "1", "on", "required", "needed", "enabled", "enable"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "off", "none", "not required", "disabled", "disable", "skip"]);

function pathOf(path: (string | number)[]): string {
  return path.length ? path.join(".") : "(root)";
}

function getAt(root: unknown, path: (string | number)[]): unknown {
  return path.reduce<unknown>((node, key) => {
    if (node === null || typeof node !== "object") return undefined;
    return (node as Record<string | number, unknown>)[key];
  }, root);
}

/** Writes a value at a path, cloning each node on the way so the caller's input is never mutated. */
function setAt(root: unknown, path: (string | number)[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [key, ...rest] = path;

  if (Array.isArray(root)) {
    const copy = [...root];
    const index = Number(key);
    copy[index] = setAt(copy[index], rest, value);
    return copy;
  }

  const source = root !== null && typeof root === "object" ? (root as Record<string, unknown>) : {};
  return { ...source, [String(key)]: setAt(source[String(key)], rest, value) };
}

/** A number hiding in a string: "8", "8s", "60 seconds", "1,080". Not "eight". */
function numberFrom(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const match = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanFrom(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return undefined;
  const word = value.trim().toLowerCase();
  if (TRUE_WORDS.has(word)) return true;
  if (FALSE_WORDS.has(word)) return false;
  return undefined;
}

/**
 * One repair for one issue, or undefined when the intent is not obvious.
 *
 * `synonyms` lets a caller map vocabulary its own domain knows about — an enum member the model
 * reached for by another name — without this file knowing anything about that domain.
 */
function repairFor(
  issue: ZodIssue,
  current: unknown,
  synonyms: Record<string, string>,
): { value: unknown; note: string } | undefined {
  const where = pathOf(issue.path);

  if (issue.code === "invalid_type") {
    if (issue.expected === "boolean") {
      const value = booleanFrom(current);
      if (value !== undefined) return { value, note: `${where}: read ${JSON.stringify(current)} as ${value}.` };
    }
    if (issue.expected === "number" || issue.expected === "integer") {
      const parsed = numberFrom(current);
      if (parsed !== undefined) {
        const value = issue.expected === "integer" ? Math.round(parsed) : parsed;
        return { value, note: `${where}: read ${JSON.stringify(current)} as ${value}.` };
      }
    }
    if (issue.expected === "string" && (typeof current === "number" || typeof current === "boolean")) {
      return { value: String(current), note: `${where}: read ${JSON.stringify(current)} as text.` };
    }
    if (issue.expected === "array" && current !== undefined && current !== null && !Array.isArray(current)) {
      return { value: [current], note: `${where}: a single value read as a list of one.` };
    }
  }

  if (issue.code === "invalid_enum_value" && typeof current === "string") {
    const mapped = synonyms[current.trim().toLowerCase().replace(/[\s-]+/g, "_")];
    if (mapped && issue.options?.includes(mapped)) {
      return { value: mapped, note: `${where}: "${current}" read as "${mapped}".` };
    }
  }

  return undefined;
}

/**
 * Parses `input` against `schema`, repairing what it can between attempts.
 *
 * Bounded passes, because each one is driven by the issues the last produced: without a limit a
 * repair that keeps failing in a new way would loop. Three is well past what a real model response
 * needs — a plan with more unambiguous type slips than that is not a plan worth rescuing.
 */
export function coerceToSchema<T>(
  schema: ZodTypeAny,
  input: unknown,
  options: { synonyms?: Record<string, string>; maxPasses?: number } = {},
): CoercionResult<T> {
  const synonyms = options.synonyms ?? {};
  const maxPasses = options.maxPasses ?? 3;
  const notes: string[] = [];

  let candidate = input;

  for (let pass = 0; pass <= maxPasses; pass++) {
    const parsed = schema.safeParse(candidate);
    if (parsed.success) return { data: parsed.data as T, notes, issues: [] };

    const issues = parsed.error.issues;
    let repairedAny = false;

    for (const issue of issues) {
      const repair = repairFor(issue, getAt(candidate, issue.path), synonyms);
      if (!repair) continue;
      candidate = setAt(candidate, issue.path, repair.value);
      notes.push(repair.note);
      repairedAny = true;
    }

    // Nothing further can be done honestly; report what is still wrong rather than looping.
    if (!repairedAny) return { notes, issues };
  }

  const final = schema.safeParse(candidate);
  return final.success
    ? { data: final.data as T, notes, issues: [] }
    : { notes, issues: final.error.issues };
}
