import { describe, it, expect } from "vitest";
import { planAutoCast } from "./auto-cast";
import type { GeneratedStory } from "@/core/ai/types";

function story(overrides: Partial<GeneratedStory> = {}): GeneratedStory {
  return {
    title: "The Lost Kite",
    language: "en",
    characters: [
      { name: "Meera", role: "a curious girl" },
      { name: "Dadi", role: "her grandmother" },
    ],
    scenes: [
      { index: 0, visual: "A rooftop at sunrise.", dialogue: "Look!", camera: "wide", emotion: "happy" },
      { index: 1, visual: "The kite drifts over the market.", dialogue: "Oh no.", camera: "pan", emotion: "sad" },
    ],
    raw: "",
    ...overrides,
  };
}

describe("planAutoCast", () => {
  it("casts every named character in the story", () => {
    const plan = planAutoCast(story());
    expect(plan.characters.map((c) => c.name)).toEqual(["Meera", "Dadi"]);
  });

  it("caps the cast so one request cannot fan out into an unbounded character-sheet run", () => {
    const plan = planAutoCast(
      story({
        characters: [
          { name: "A", role: "" },
          { name: "B", role: "" },
          { name: "C", role: "" },
          { name: "D", role: "" },
          { name: "E", role: "" },
        ],
      }),
    );
    expect(plan.characters).toHaveLength(3);
  });

  it("treats names differing only in case or padding as one character", () => {
    const plan = planAutoCast(
      story({
        characters: [
          { name: "Meera", role: "a girl" },
          { name: " meera ", role: "the same girl, spelled differently by the model" },
        ],
      }),
    );
    expect(plan.characters).toHaveLength(1);
  });

  it("drops nameless entries rather than creating a character called ''", () => {
    const plan = planAutoCast(story({ characters: [{ name: "  ", role: "narrator" }, { name: "Meera", role: "a girl" }] }));
    expect(plan.characters.map((c) => c.name)).toEqual(["Meera"]);
  });

  it("puts the character's role into the master prompt so the sheet is not generated from a bare name", () => {
    const plan = planAutoCast(story());
    expect(plan.characters[0]?.masterPrompt).toContain("a curious girl");
    expect(plan.characters[0]?.masterPrompt).toContain("The Lost Kite");
  });

  it("describes the background from the story's own scene visuals", () => {
    const plan = planAutoCast(story());
    expect(plan.background.description).toContain("A rooftop at sunrise.");
    expect(plan.background.description).toContain("The kite drifts over the market.");
  });

  it("still produces a usable background when the story has no scene visuals", () => {
    const plan = planAutoCast(story({ scenes: [] }));
    expect(plan.background.description).toContain("The Lost Kite");
    expect(plan.background.name).toBe("The Lost Kite");
  });

  it("never returns an empty background name, which the model requires", () => {
    const plan = planAutoCast(story({ title: "   " }));
    expect(plan.background.name).toBe("Main setting");
  });
});
