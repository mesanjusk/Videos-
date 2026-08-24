/**
 * The single browser automation engine.
 *
 * Before the merge there were three Playwright implementations across the two projects: this
 * project's Google-Flow-specific Module 4 driver, its provider-agnostic Module 7A framework, and
 * Browser Automation OS's `packages/browser`. Neither of the surviving two was a superset of the
 * other — the framework owned the run lifecycle (pause/resume/cancel across processes, crash
 * recovery, persisted resume state) while Project B owned the action layer (self-healing selector
 * resolution, secret interpolation, a 23-verb node vocabulary). This directory is the graft of
 * both; docs/MERGE-AUDIT.md §10 has the capability-by-capability comparison behind that decision.
 *
 * Persistence stays out: the framework talks to `SessionStore`/`StateStore`/`TaskStore`
 * interfaces, and `modules/browser-automation/` supplies the Mongo-backed implementations.
 */

// Vocabulary and contracts
export * from "./shared";
export * from "./types";

// Lifecycle (from this project's Module 7A framework)
export * from "./event-bus";
export * from "./session-manager";
export * from "./browser-manager";
export * from "./tab-manager";
export * from "./state-engine";
export * from "./recovery-engine";
export * from "./execution-monitor";
export * from "./provider-adapter";
export * from "./task-engine";
export * from "./action-pipeline";

// Action layer (from Browser Automation OS)
export * from "./action-engine";
export * from "./selectors/resolver";
export * from "./interpolate";
export * from "./page-snapshot";
export * from "./session";
export * from "./actions";
