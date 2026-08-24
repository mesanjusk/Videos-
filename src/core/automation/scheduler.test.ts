import { describe, it, expect } from "vitest";
import { computeNextRun } from "./scheduler";

const from = new Date("2026-03-01T10:00:00Z");

describe("computeNextRun", () => {
  it("advances the fixed frequencies", () => {
    expect(computeNextRun("HOURLY", undefined, from, "UTC").toISOString()).toBe("2026-03-01T11:00:00.000Z");
    expect(computeNextRun("DAILY", undefined, from, "UTC").toISOString()).toBe("2026-03-02T10:00:00.000Z");
    expect(computeNextRun("WEEKLY", undefined, from, "UTC").toISOString()).toBe("2026-03-08T10:00:00.000Z");
  });

  it("parses a cron expression in the schedule's own timezone", () => {
    // 09:00 in Asia/Kolkata (UTC+5:30) is 03:30 UTC — the next one after 10:00 UTC is tomorrow's.
    const next = computeNextRun("CRON", "0 9 * * *", from, "Asia/Kolkata");
    expect(next.toISOString()).toBe("2026-03-02T03:30:00.000Z");
  });

  it("falls back to daily rather than throwing when CRON has no expression", () => {
    expect(computeNextRun("CRON", undefined, from, "UTC").toISOString()).toBe("2026-03-02T10:00:00.000Z");
  });

  it("leaves ONCE where it is — the sweeper disables it instead of rescheduling", () => {
    expect(computeNextRun("ONCE", undefined, from, "UTC").toISOString()).toBe(from.toISOString());
  });
});
