import { describe, it, expect, vi } from "vitest";
import { safeFileName, toSelectorTarget, PlaywrightActionEngine } from "./action-engine";

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

  it("reports which selector strategy actually resolved the element", async () => {
    const seen: string[] = [];
    const locator = { click: async () => {}, waitFor: async () => {}, first: () => locator, nth: () => locator };
    const page = { locator: () => locator, getByTestId: () => locator } as never;

    const engine = new PlaywrightActionEngine({ onSelectorResolved: (s) => seen.push(s) });
    await engine.click(page, { testId: "generate" });

    expect(seen).toEqual(["css"]); // getByTestId is reported under the css strategy by the resolver
  });
});
