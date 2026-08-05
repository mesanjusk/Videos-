/**
 * Provider-agnostic Browser Automation Framework (Module 7A).
 * See docs/BROWSER-AUTOMATION-FRAMEWORK-PLAN.md — zero Google Flow / provider-specific logic here.
 * Module 7B (a future module) will register the first real ProviderAdapter.
 */

export * from "./types";
export * from "./event-bus";
export * from "./session-manager";
export * from "./browser-manager";
export * from "./tab-manager";
export * from "./action-engine";
export * from "./action-pipeline";
export * from "./state-engine";
export * from "./recovery-engine";
export * from "./execution-monitor";
export * from "./provider-adapter";
export * from "./task-engine";
