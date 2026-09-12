import { describe, it, expect, vi } from "vitest";
import { safeFileName, toSelectorTarget, PlaywrightActionEngine, classifyTextEntry } from "./action-engine";

/**
 * A prompt box that behaves like one. `rejectsFill` is the rich-text editor case (Lexical throws
 * on fill), `swallowsFill` the worse one: fill resolves and the field is still empty, which is
 * what a controlled component that never saw an input event looks like from the outside.
 */
function promptBox(behaviour: { rejectsFill?: boolean; swallowsFill?: boolean; unreadable?: boolean } = {}) {
  const calls: string[] = [];
  let value = "";
  const locator = {
    calls,
    get value() {
      return value;
    },
    click: async () => void calls.push("click"),
    fill: async (v: string) => {
      calls.push("fill");
      if (behaviour.rejectsFill) throw new Error("Element is not an <input>, <textarea> or [contenteditable]");
      if (!behaviour.swallowsFill) value = v;
    },
    pressSequentially: async (v: string) => {
      calls.push("pressSequentially");
      value = v;
    },
    inputValue: async () => {
      if (behaviour.unreadable) throw new Error("not an input");
      return value;
    },
    textContent: async () => (behaviour.unreadable ? null : value),
    waitFor: async () => {},
    first: () => locator,
    nth: () => locator,
  };
  return locator;
}

describe("toSelectorTarget", () => {
  it("treats a bare string as a css target, so existing provider adapters keep working", () => {
    expect(toSelectorTarget("button.go")).toEqual({ css: "button.go" });
  });

  it("passes a rich target through untouched", () => {
    const target = { css: "button.go", role: "button", text: "Generate" };
    expect(toSelectorTarget(target)).toBe(target);
  });
});

describe("safeFileName", () => {
  it("reduces a traversal attempt to a harmless basename", () => {
    // The remote page chooses this string. Before the merge it was joined straight onto the
    // output directory.
    expect(safeFileName("../../etc/cron.d/payload")).toBe("payload");
    expect(safeFileName("../../../root/.ssh/authorized_keys")).toBe("authorized_keys");
  });

  it("strips characters that are not filename-safe", () => {
    expect(safeFileName("my clip;rm -rf.mp4")).toBe("my_clip_rm_-rf.mp4");
  });

  it("neutralises a leading-dot name", () => {
    expect(safeFileName(".bashrc")).toBe("_bashrc");
  });

  it("falls back to a generated name when nothing usable remains", () => {
    expect(safeFileName("/")).toMatch(/^download-\d+$/);
  });

  it("leaves an ordinary filename alone", () => {
    expect(safeFileName("scene-3.mp4")).toBe("scene-3.mp4");
  });
});

describe("PlaywrightActionEngine text handling", () => {
  it("resolves {{secret:…}} into the Playwright call without exposing it to the variable bag", async () => {
    const variables: Record<string, unknown> = { user: "asha" };
    const resolveSecret = vi.fn(async (name: string) => (name === "flowPassword" ? "s3cr3t" : undefined));
    const filled: string[] = [];

    const locator = {
      fill: async (v: string) => void filled.push(v),
      waitFor: async () => {},
      first: () => locator,
      nth: () => locator,
    };
    const page = { locator: () => locator } as never;

    const engine = new PlaywrightActionEngine({ variables, resolveSecret });
    await engine.inputText(page, "#pw", "{{user}}:{{secret:flowPassword}}");

    expect(filled).toEqual(["asha:s3cr3t"]);
    expect(resolveSecret).toHaveBeenCalledWith("flowPassword");
    // The secret must not have leaked into the shared variable bag, which is what gets logged and
    // sent to an AI prompt.
    expect(JSON.stringify(variables)).not.toContain("s3cr3t");
  });

  it("enters a prompt through Playwright's input pipeline, not a DOM assignment", async () => {
    // The bug this replaces: `el.value = v` inside locator.evaluate dispatches no input event, so
    // React's onChange never fires, Flow's Generate button stays disabled, and the run degrades to
    // the manual hand-off one step from a finished clip.
    const locator = promptBox();
    const page = { locator: () => locator } as never;

    await new PlaywrightActionEngine().paste(page, "#prompt", "a red bicycle at dawn");

    expect(locator.calls).toEqual(["click", "fill"]);
    expect(locator.value).toBe("a red bicycle at dawn");
  });

  it("types the prompt when a rich-text editor refuses fill()", async () => {
    const locator = promptBox({ rejectsFill: true });
    const page = { locator: () => locator } as never;

    await new PlaywrightActionEngine().paste(page, "#prompt", "a red bicycle");

    expect(locator.calls).toEqual(["click", "fill", "pressSequentially"]);
    expect(locator.value).toBe("a red bicycle");
  });

  it("retypes when fill() reports success but leaves the field empty", async () => {
    // An editor that keeps its own model: fill resolves, the box is still blank, and nothing but
    // reading it back can tell.
    const locator = promptBox({ swallowsFill: true });
    const page = { locator: () => locator } as never;

    await new PlaywrightActionEngine().paste(page, "#prompt", "a red bicycle");

    expect(locator.calls).toEqual(["click", "fill", "pressSequentially"]);
    expect(locator.value).toBe("a red bicycle");
  });

  it("does not retype into a box it cannot read back", async () => {
    // Unreadable is not evidence of failure, and typing a long prompt twice is its own bug.
    const locator = promptBox({ unreadable: true });
    const page = { locator: () => locator } as never;

    await new PlaywrightActionEngine().paste(page, "#prompt", "a red bicycle");

    expect(locator.calls).toEqual(["click", "fill"]);
  });

  it("resolves a secret before the text reaches the page", async () => {
    const locator = promptBox();
    const page = { locator: () => locator } as never;
    const engine = new PlaywrightActionEngine({ resolveSecret: async () => "s3cr3t" });

    await engine.paste(page, "#prompt", "pw:{{secret:flowPassword}}");

    expect(locator.value).toBe("pw:s3cr3t");
  });

  it("reports which selector strategy actually resolved the element", async () => {
    const seen: string[] = [];
    const locator = { click: async () => {}, waitFor: async () => {}, first: () => locator, nth: () => locator };
    const page = { locator: () => locator, getByTestId: () => locator } as never;

    const engine = new PlaywrightActionEngine({ onSelectorResolved: (s) => seen.push(s) });
    await engine.click(page, { testId: "generate" });

    expect(seen).toEqual(["css"]); // getByTestId is reported under the css strategy by the resolver
  });
});

describe("classifyTextEntry", () => {
  const from = (value: string | null, throwsOnInputValue = false) => ({
    inputValue: async () => {
      if (throwsOnInputValue) throw new Error("not an input");
      return value ?? "";
    },
    textContent: async () => value,
  });

  it("calls a filled field applied", async () => {
    expect(await classifyTextEntry(from("a red bicycle"), "a red bicycle")).toBe("applied");
  });

  it("calls an empty field empty, which is the only case worth retyping", async () => {
    expect(await classifyTextEntry(from(""), "a red bicycle")).toBe("empty");
  });

  it("accepts a value the editor normalized rather than demanding an exact match", async () => {
    // Whitespace collapsing, a stripped newline, a wrapped line — all still applied.
    expect(await classifyTextEntry(from("a red bicycle at dawn"), "a red bicycle\nat dawn")).toBe("applied");
  });

  it("reads contenteditable text when inputValue does not apply", async () => {
    expect(await classifyTextEntry(from("a red bicycle", true), "a red bicycle")).toBe("applied");
  });

  it("reports unknown when neither read works", async () => {
    expect(await classifyTextEntry(from(null, true), "a red bicycle")).toBe("unknown");
  });
});
