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

/** Whether the page still says work is in progress. Shared by CLIP_READY and GENERATING. */
function isBusy(p: PageSignals): boolean {
  return /generating|rendering|creating your|this may take/i.test(p.text) || p.hasProgressbar;
}

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
  // A finished clip, and it has to be tested before GENERATING: Flow keeps the "generating" label
  // on screen for a moment after the video appears.
  //
  // The download control used to be required here, and that was too strict to be reachable. Flow
  // puts Download behind a hover affordance or an overflow menu, so a clip that is finished and
  // playing can have no visible download button at all — the run then waited out its full
  // five-minute render timeout on a state that had already arrived and fell back to the manual
  // hand-off with the clip sitting right there on screen.
  //
  // So a download control is now sufficient, not necessary: a video with nothing on the page still
  // claiming to be working is just as much a finished render. `isBusy` is what keeps that honest —
  // while the label or a progress bar is up, this stays GENERATING and keeps polling, which is the
  // one case where waiting is the right answer.
  { screen: "CLIP_READY", test: (p) => p.hasVideo && (p.hasDownloadControl || !isBusy(p)) },
  { screen: "GENERATING", test: isBusy },
  { screen: "PROMPT_READY", test: (p) => p.hasPromptInput },
  { screen: "WORKSPACE", test: (p) => p.hasTimeline || /new project|your projects/i.test(p.text) },
  { screen: "LANDING", test: (p) => /flow|veo/i.test(p.title) },
];

interface PageSignals {
  url: string;
  title: string;
  text: string;
  hasPromptInput: boolean;
  /**
   * The source of every visible, loaded `<video>` — each clip's identity on this page.
   *
   * Not used for classification (that is `hasVideo`): a screen is CLIP_READY whether the clip is
   * new or was already there. Telling those apart is the *caller's* question, asked through
   * `freshClipIds` once it knows what was on the page before it pressed Generate.
   */
  clipIds: string[];
  /** A visible `<video>` with a source actually loaded — not an empty player. */
  hasVideo: boolean;
  /** A *visible* download/export/save control. Sufficient for CLIP_READY, never required. */
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
        // `title` is in here because Flow's media controls are icon-only buttons: a download that
        // carries its meaning in a tooltip rather than in text is still a download control, and
        // reading only aria-label and text missed every one of them.
        const named = (pattern: RegExp) =>
          Array.from(document.querySelectorAll('button, a[href], [role="button"], [role="menuitem"]')).some(
            (el) =>
              visible(el) &&
              pattern.test(
                `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${el.textContent ?? ""}`.replace(
                  /\s+/g,
                  " ",
                ),
              ),
          );

        // Which clips are on the page, by source.
        //
        // A <video> with nothing loaded in it is a placeholder, not a result — that distinction is
        // what stops an empty player from being read as a finished clip now that a download control
        // is no longer required for CLIP_READY. The source doubles as the clip's identity, which is
        // what lets a run tell the clip it just generated from one that was already there.
        const clipIds = Array.from(document.querySelectorAll("video"))
          .filter(visible)
          .map((el) => el.currentSrc || el.getAttribute("src") || el.querySelector("source[src]")?.getAttribute("src") || "")
          .filter((id) => id.length > 0);

        return {
          text: (document.body?.innerText ?? "").slice(0, 6000),
          hasPromptInput: anyVisible('textarea, [contenteditable="true"][role="textbox"], input[type="text"]'),
          clipIds: Array.from(new Set(clipIds)),
          hasVideo: clipIds.length > 0,
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
    clipIds: dom?.clipIds ?? [],
    hasVideo: dom?.hasVideo ?? false,
    hasDownloadControl: dom?.hasDownloadControl ?? false,
    hasProgressbar: dom?.hasProgressbar ?? false,
    hasTimeline: dom?.hasTimeline ?? false,
    hasRecaptchaFrame,
  };
}

/**
 * One reading of the page: the screen, and which clips were on it.
 *
 * The clip list is here rather than in a second read because both come from the same DOM pass —
 * asking twice would let the page change between "there is a clip" and "which clip is it", which is
 * precisely the race this exists to close.
 */
export interface FlowReading {
  screen: FlowScreen;
  /** Source of every visible, loaded clip at the moment of the reading. */
  clipIds: string[];
}

/** Reads the page once. Never throws — an unreadable page is `UNKNOWN` with no clips. */
export async function readFlowScreen(page: Page): Promise<FlowReading> {
  const signals = await readSignals(page).catch(() => null);
  if (!signals) return { screen: "UNKNOWN", clipIds: [] };
  return { screen: classifyFromSignals(signals), clipIds: signals.clipIds };
}

/** Reads the page once and names the screen. Never throws — an unreadable page is `UNKNOWN`. */
export async function classifyFlowScreen(page: Page): Promise<FlowScreen> {
  return (await readFlowScreen(page)).screen;
}

/**
 * Clips on the page now that were not there when the baseline was taken.
 *
 * This is what "a clip is ready" has to mean after pressing Generate. A Flow project that already
 * holds clips — a re-run, a resumed job, a second scene in the same workspace — shows a finished
 * video and a working download button the instant the page loads, so a run that waits only for
 * CLIP_READY can be satisfied by a clip generated minutes ago and download *that*, quietly
 * attaching the wrong video to the scene. Nothing downstream could catch it: the file is valid,
 * the duration is right, and the only way to notice is to watch the clip.
 *
 * An absent baseline (`undefined`) means nobody recorded one — a run resumed in a fresh process,
 * or an older task definition without the step param. Everything counts as fresh then, which is
 * the previous behaviour: worse, but not worse than refusing to finish a run at all.
 */
export function freshClipIds(current: readonly string[], baseline: ReadonlySet<string> | undefined): string[] {
  if (!baseline) return [...current];
  return current.filter((id) => !baseline.has(id));
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
