/**
 * Vocabulary shared by every part of the browser-automation subsystem — ported from Project B's
 * `packages/shared`, which was that project's "single source of truth for these strings" and
 * plays the same role here. Zero runtime dependencies beyond zod, so it is safe to import from a
 * client component, an edge route, a serverless route, or the worker alike.
 *
 * See docs/MERGE-AUDIT.md §30 for why this layer was ported verbatim rather than reinvented.
 */
export * from "./enums";
export * from "./errors";
export * from "./schemas/workflow";
export * from "./schemas/ai";
export * from "./schemas/api";
