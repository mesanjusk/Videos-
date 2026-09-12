import { describe, it, expect } from "vitest";
import { classifyFromSignals, freshClipIds, TERMINAL_SCREENS, type PageSignals } from "./state";

function signals(overrides: Partial<PageSignals> = {}): PageSignals {
  return {
    url: "https://flow.google/project/abc",
    title: "Flow",
    text: "",
    hasPromptInput: false,
    clipIds: [],
    hasVideo: false,
    hasDownloadControl: false,
    hasProgressbar: false,
    hasTimeline: false,
    hasRecaptchaFrame: false,
    ...overrides,
  };
}

describe("classifyFromSignals", () => {
  it("names a signed-out session instead of reporting a missing element", () => {
    expect(classifyFromSignals(signals({ url: "https://accounts.google.com/signin" }))).toBe("SIGNED_OUT");
    expect(classifyFromSignals(signals({ text: "Sign in to continue" }))).toBe("SIGNED_OUT");
  });

  it("does not call a working page signed-out just because the words appear on it", () => {
    // A workspace can carry a "Sign in to another account" menu item. The prompt box is what says
    // this session is actually usable.
    expect(classifyFromSignals(signals({ text: "Sign in to another account", hasPromptInput: true }))).toBe("PROMPT_READY");
  });

  it("detects a verification challenge ahead of every other signal", () => {
    // A challenge can be overlaid on a page that still shows its prompt box underneath. Reading
    // that as PROMPT_READY is how a run spends its whole render timeout typing into a blocked page.
    expect(classifyFromSignals(signals({ text: "Verify you're human", hasPromptInput: true }))).toBe("CHALLENGE");
    expect(classifyFromSignals(signals({ hasRecaptchaFrame: true, hasPromptInput: true }))).toBe("CHALLENGE");
  });

  it("prefers a ready clip over a lingering 'generating' label", () => {
    // Flow leaves the label up for a moment after the video appears; treating that as GENERATING
    // makes the run wait for a state it has already passed.
    expect(
      classifyFromSignals(signals({ text: "Generating your clip", hasVideo: true, hasDownloadControl: true })),
    ).toBe("CLIP_READY");
  });

  it("keeps waiting while the page still says it is working, download control or not", () => {
    expect(classifyFromSignals(signals({ hasVideo: true, text: "Generating" }))).toBe("GENERATING");
    expect(classifyFromSignals(signals({ hasVideo: true, hasProgressbar: true }))).toBe("GENERATING");
  });

  it("calls a finished clip ready even when Download is hidden behind a menu", () => {
    // Requiring a *visible* download control made CLIP_READY unreachable on a Flow that puts
    // Download behind a hover affordance or an overflow menu: the clip was playing on screen while
    // the run waited out its five-minute render timeout and fell back to the manual hand-off.
    // Nothing claiming to be in progress plus a loaded video is a finished render.
    expect(classifyFromSignals(signals({ hasVideo: true }))).toBe("CLIP_READY");
  });

  it("reads a progress bar as still working", () => {
    expect(classifyFromSignals(signals({ hasProgressbar: true }))).toBe("GENERATING");
  });

  it("recognises Flow's own failure text", () => {
    expect(classifyFromSignals(signals({ text: "Something went wrong. Try again." }))).toBe("ERROR");
  });

  it("falls through to UNKNOWN rather than guessing", () => {
    expect(classifyFromSignals(signals({ title: "" }))).toBe("UNKNOWN");
  });

  it("gives every screen a run cannot proceed from an explanation a person can act on", () => {
    for (const [screen, message] of Object.entries(TERMINAL_SCREENS)) {
      expect(message, `${screen} needs a message`).toBeTruthy();
      expect(message!.length).toBeGreaterThan(20);
    }
    // The two that need a human are named; a slow render is not in here, because waiting is not a
    // failure.
    expect(Object.keys(TERMINAL_SCREENS)).toEqual(expect.arrayContaining(["SIGNED_OUT", "CHALLENGE"]));
    expect(Object.keys(TERMINAL_SCREENS)).not.toContain("GENERATING");
  });
});

describe("freshClipIds", () => {
  it("names only the clips that were not there before", () => {
    // The point of the whole mechanism: a project that already holds a clip shows a finished video
    // and a working download button the moment it loads, and downloading that one attaches the
    // wrong video to the scene with nothing downstream able to notice.
    expect(freshClipIds(["blob:old", "blob:new"], new Set(["blob:old"]))).toEqual(["blob:new"]);
  });

  it("returns nothing when the page still holds only the clip it started with", () => {
    expect(freshClipIds(["blob:old"], new Set(["blob:old"]))).toEqual([]);
  });

  it("counts a re-sourced player as a new clip", () => {
    // Flow may reuse the same <video> element and swap its src. Same element, different clip.
    expect(freshClipIds(["blob:second"], new Set(["blob:first"]))).toEqual(["blob:second"]);
  });

  it("treats everything as fresh when no baseline was recorded", () => {
    // A run resumed in another process, or an older stored task definition. Degrades to the old
    // behaviour rather than refusing to ever finish.
    expect(freshClipIds(["blob:whatever"], undefined)).toEqual(["blob:whatever"]);
  });
});
