/**
 * Thrown whenever the Browser Automation Engine hits something it should never push through
 * blindly: the Flow session looks logged out, a selector it expected isn't there (Flow's DOM
 * changed, or a verification/CAPTCHA challenge appeared), or a step ran past its timeout.
 *
 * The one rule this error type exists to enforce: automation must degrade to the existing manual
 * hand-off, never retry the same broken interaction in a loop and never guess. Every catch site
 * for this error falls back to `VideoGenerationResult.manual_pending` — see
 * core/ai/providers/google/google-flow-automated.ts.
 */
export class AutomationCircuitBreakerError extends Error {
  constructor(
    public readonly reason: "session_expired" | "selector_not_found" | "verification_challenge" | "timeout" | "unexpected_page",
    message: string,
  ) {
    super(message);
    this.name = "AutomationCircuitBreakerError";
  }
}
