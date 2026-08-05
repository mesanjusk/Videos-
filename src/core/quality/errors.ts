import type { QualityIssue } from "./types";

/**
 * Thrown only for "error"-severity issues on AI-synchronous generation paths (character sheet,
 * background, scene image, thumbnail images; the browser-automation video completion) — never for
 * a human-uploaded manual hand-off, where retrying would mean silently discarding someone's
 * deliberate upload. Caught by nothing special: it flows through the same
 * core/queue/processors/helpers.ts#withJobLifecycle catch block every other processor error does,
 * so BullMQ's existing attempts/backoff (and the "retrying" status from the Scene Queue module)
 * apply for free — this is the "REFACTOR: blind attempt-count retry -> validation-triggered retry"
 * the roadmap describes, not a new retry system.
 */
export class QualityCheckFailedError extends Error {
  constructor(public readonly issues: QualityIssue[]) {
    super(`Quality check failed: ${issues.map((i) => i.message).join("; ")}`);
    this.name = "QualityCheckFailedError";
  }
}
