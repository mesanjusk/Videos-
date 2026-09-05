import type { Page } from "playwright";

/**
 * Which Google Flow screen is actually on display.
 *
 * ## Why this is worth having
 *
 * The step sequence in `build-task.ts` used to be a straight line: click New project, click Upload,
 * paste, click Generate, wait for a `<video>`, click Download. Every one of those steps assumed the
 * screen it expected was already there. When it wasn't — Flow signed the session out overnight, an
 * interstitial appeared, the project opened straight into an existing workspace — the run failed as
 * a selector timeout, and a selector timeout tells an operator nothing about what went wrong. "The
 * download button was not visible after 120 seconds" and "you are signed out" are the same message.
 *
 * Classifying the screen first turns those into different, actionable outcomes:
 * `GOOGLE_LOGIN_REQUIRED` sends someone to the Accounts page to reconnect a session;
 * `VERIFICATION_CHALLENGE` is a human's job by policy (this codebase does not work around a
 * CAPTCHA or an MFA prompt, ever); `GENERATING` just means keep waiting.
 *
 * Ported from the `FLOW_NAVIGATE`/`WAIT_FOR_STATE` state driver in mesanjusk/automation.
 *
 * ## The honest caveat, unchanged
 *
 * These signals are read from a product with no published DOM contract, by a codebase with no
 * Google account to verify against — same caveat `selectors.ts` carries. They are deliberately
 * built from *text and roles* rather than class names, because those are what survive a redesign,
 * and every classification falls through to `UNKNOWN` rather than guessing. `UNKNOWN` is a real
 * answer here: it means "keep polling", not "fail".
 */
export type FlowScreen =
  | "SIGNED_OUT"
  | "CHALLENGE"
  | "LANDING"
  | "WORKSPACE"
  | "PROMPT_READY"
  | "GENERATING"
  | "CLIP_READY"
  | "ERROR"
  | "UNKNOWN";

/** Ordered most-specific first — the first matching signal wins. */
const SIGNALS: { screen: FlowScreen; test: (page: PageSignals) => boolean }[] = [
  // Checked before everything: a challenge can be overlaid on any screen, and mistaking one for a
  // slow-loading workspace is how a run burns its whole render timeout on a page asking it to
  // prove it is human.
  {
    screen: "CHALLENGE",
    test: (p) => /verify you.?re human|unusual traffic|confirm you.?re not a robot/i.test(p.text) || p.hasRecaptchaFrame,
  },
  {
    screen: "SIGNED_OUT",
    test: (p) => /accounts\.google\.com/.test(p.url) || (/sign in|choose an account/i.test(p.text) && !p.hasPromptInput),
  },
  {
    screen: "ERROR",
    test: (p) => /something went wrong|couldn.?t generate|generation failed|try again later/i.test(p.text),
  },
  // A visible video with a download control is the finish line, and it has to be tested before
  // GENERATING: Flow keeps the "generating" label on screen for a moment after the clip appears.
  { screen: "CLIP_READY", test: (p) => p.hasVideo && p.hasDownloadControl },
  { screen: "GENERATING", test: (p) => /generating|rendering|creating your|this may take/i.test(p.text) || p.hasProgressbar },
  { screen: "PROMPT_READY", test: (p) => p.hasPromptInput },
  { screen: "WORKSPACE", test: (p) => p.hasTimeline || /new project|your projects/i.test(p.text) },
  { screen: "LANDING", test: (p) => /flow|veo/i.test(p.title) },
];

interface PageSignals {
  url: string;
  title: string;
  text: string;
  hasPromptInput: boolean;
  hasVideo: boolean;
  hasDownloadControl: boolean;
  hasProgressbar: boolean;
  hasTimeline: boolean;
  hasRecaptchaFrame: boolean;
}

async function readSignals(page: Page): Promise<PageSignals> {
  const [url, title, dom] = await Promise.all([
    Promise.resolve(page.url()),
    page.title().catch(() => ""),
    page
      .evaluate(() => {
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const anyVisible = (selector: string) => Array.from(document.querySelectorAll(selector)).some(visible);
        const named = (pattern: RegExp) =>
          Array.from(document.querySelectorAll('button, a[href], [role="button"], [role="menuitem"]')).some(
            (el) =>
              visible(el) &&
              pattern.test(`${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""}`.replace(/\s+/g, " ")),
          );

        return {
          text: (document.body?.innerText ?? "").slice(0, 6000),
          hasPromptInput: anyVisible('textarea, [contenteditable="true"][role="textbox"], input[type="text"]'),
          hasVideo: anyVisible("video"),
          hasDownloadControl: named(/download|export|save/i),
          hasProgressbar: anyVisible('[role="progressbar"], progress'),
          hasTimeline: anyVisible('[data-testid="timeline"], [aria-label*="timeline" i]'),
        };
      })
      .catch(() => null),
  ]);

  const hasRecaptchaFrame = page.frames().some((f) => /recaptcha|challenges\.cloudflare/.test(f.url()));

  return {
    url,
    title,
    text: dom?.text ?? "",
    hasPromptInput: dom?.hasPromptInput ?? false,
    hasVideo: dom?.hasVideo ?? false,
    hasDownloadControl: dom?.hasDownloadControl ?? false,
    hasProgressbar: dom?.hasProgressbar ?? false,
    hasTimeline: dom?.hasTimeline ?? false,
    hasRecaptchaFrame,
  };
}

/** Reads the page once and names the screen. Never throws — an unreadable page is `UNKNOWN`. */
export async function classifyFlowScreen(page: Page): Promise<FlowScreen> {
  const signals = await readSignals(page).catch(() => null);
  if (!signals) return "UNKNOWN";
  return classifyFromSignals(signals);
}

/** The pure decision, exported so the signal precedence is testable without a browser. */
export function classifyFromSignals(signals: PageSignals): FlowScreen {
  for (const signal of SIGNALS) {
    if (signal.test(signals)) return signal.screen;
  }
  return "UNKNOWN";
}

export type { PageSignals };

/** Screens a run can never proceed from, mapped to the message an operator actually needs. */
export const TERMINAL_SCREENS: Partial<Record<FlowScreen, string>> = {
  SIGNED_OUT:
    "This Google account is signed out of Flow. Reconnect its browser session on the Accounts page — " +
    "the automation never signs in on your behalf.",
  CHALLENGE:
    "Google is showing a human-verification challenge. That has to be answered by a person in a real " +
    "browser session; this automation will not attempt to work around it.",
  ERROR: "Google Flow reported that generation failed.",
};
