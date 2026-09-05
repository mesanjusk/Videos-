import { describe, it, expect } from "vitest";
import { classifyFromSignals, TERMINAL_SCREENS, type PageSignals } from "./state";

function signals(overrides: Partial<PageSignals> = {}): PageSignals {
  return {
    url: "https://flow.google/project/abc",
    title: "Flow",
    text: "",
    hasPromptInput: false,
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

  it("does not call a video ready when there is no way to download it", () => {
    expect(classifyFromSignals(signals({ hasVideo: true, text: "Generating" }))).toBe("GENERATING");
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
