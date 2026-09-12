import { describe, it, expect } from "vitest";
import {
  checkStalled,
  describeStall,
  STALL_AFTER_MS,
  SLOW_STALL_AFTER_MS,
  FAST_STALL_AFTER_MS,
  PARKED_STALL_AFTER_MS,
} from "./stall";
import { computeProgress } from "@/core/production/progress";

const now = Date.UTC(2026, 8, 7, 12, 0, 0);
const agedBy = (ms: number) => new Date(now - ms);

describe("checkStalled", () => {
  it("calls a job that has not moved in far too long stalled", () => {
    const report = checkStalled({ type: "production_plan", status: "running", updatedAt: agedBy(STALL_AFTER_MS + 1) }, now);
    expect(report.stalled).toBe(true);
  });

  it("judges a one-API-call job in minutes, not tens of minutes", () => {
    // A plan job is seconds of work. Ten minutes of silence from one is not lateness, and waiting
    // ten minutes to say so is most of why a stranded job felt like a broken app.
    expect(checkStalled({ type: "production_plan", status: "retrying", updatedAt: agedBy(FAST_STALL_AFTER_MS + 1) }, now).stalled).toBe(true);
    expect(checkStalled({ type: "production_plan", status: "retrying", updatedAt: agedBy(60_000) }, now).stalled).toBe(false);
  });

  it("catches a job parked on something that never came back", () => {
    // manual_pending means nothing happens automatically. The poller could not tell that from
    // progress, so it span against a job that was, from the user's side, simply not moving.
    const parked = {
      type: "character_image" as const,
      status: "manual_pending" as const,
      updatedAt: agedBy(PARKED_STALL_AFTER_MS + 1),
    };
    expect(checkStalled(parked, now).stalled).toBe(true);
    expect(describeStall(parked, checkStalled(parked, now))).toContain("waiting on something outside the app");
  });

  it("does not call a park stuck on the clock of the API call it replaced", () => {
    // A character sheet of eight poses is eight browser missions in one Chrome tab: it passes the
    // ten-minute default while working perfectly, and the retry offered for it cancels the very job
    // the missions are coming back to.
    const parked = {
      type: "character_image" as const,
      status: "manual_pending" as const,
      updatedAt: agedBy(STALL_AFTER_MS + 60_000),
    };
    expect(checkStalled(parked, now).stalled).toBe(false);
  });

  it("leaves a job that is merely slow alone", () => {
    // Late is not stuck. Calling a working job dead is its own kind of wrong.
    expect(checkStalled({ type: "scene_image", status: "running", updatedAt: agedBy(60_000) }, now).stalled).toBe(false);
  });

  it("gives a render far longer before judging it, because a render takes far longer", () => {
    const idle = STALL_AFTER_MS + 60_000;
    expect(checkStalled({ type: "render", status: "running", updatedAt: agedBy(idle) }, now).stalled).toBe(false);
    expect(checkStalled({ type: "render", status: "running", updatedAt: agedBy(SLOW_STALL_AFTER_MS + 1) }, now).stalled).toBe(true);
  });

  it("never calls a finished job stalled, however old it is", () => {
    for (const status of ["completed", "failed", "cancelled"] as const) {
      expect(checkStalled({ type: "story", status, updatedAt: agedBy(SLOW_STALL_AFTER_MS * 10) }, now).stalled).toBe(false);
    }
  });

  it("catches a job that never started as well as one abandoned mid-flight", () => {
    const queued = { type: "story" as const, status: "queued" as const, updatedAt: agedBy(STALL_AFTER_MS + 1) };
    expect(checkStalled(queued, now).stalled).toBe(true);
    expect(describeStall(queued, checkStalled(queued, now))).toContain("waiting to start");
  });

  it("says nothing about a job that is fine", () => {
    const job = { type: "story" as const, status: "running" as const, updatedAt: agedBy(1000) };
    expect(describeStall(job, checkStalled(job, now))).toBeUndefined();
  });
});

describe("progress when the pipeline stops", () => {
  const base = { projectStatus: "story", hasFinalVideo: false, sceneStatuses: ["pending"], canMakeVideo: true };

  it("stops claiming progress and offers the one button that helps", () => {
    const report = computeProgress({ ...base, jobStatuses: ["running"], stalled: true });
    expect(report.phase).toBe("problem");
    expect(report.busy).toBe(false);
    expect(report.action).toEqual({ label: "Try again", target: "retry" });
  });

  it("still reads as working while the job is genuinely running", () => {
    const report = computeProgress({ ...base, jobStatuses: ["running"] });
    expect(report.busy).toBe(true);
    expect(report.phase).not.toBe("problem");
  });

  it("does not hide a finished video behind a stalled leftover job", () => {
    const report = computeProgress({ ...base, hasFinalVideo: true, jobStatuses: ["running"], stalled: true });
    expect(report.phase).toBe("ready");
  });
});
