import { describe, it, expect } from "vitest";
import { NoAvailableGoogleAccountError } from "./selector";

describe("NoAvailableGoogleAccountError", () => {
  it("does not blame quota when no account was ever connected", () => {
    // The live report this exists for: "it's not possible quota exhaust, we haven't used it for
    // 3-4 days." Correct — nothing had been used, because nothing was connected. Telling someone to
    // wait for a quota to reset sends them to wait out a number that was never counted.
    const err = new NoAvailableGoogleAccountError("user-1", "none-connected");
    expect(err.message).toContain("No Google account is connected");
    expect(err.message).toContain("not a quota problem");
    expect(err.message).not.toMatch(/wait for quota/i);
  });

  it("says so when accounts exist but every one is switched off", () => {
    const err = new NoAvailableGoogleAccountError("user-1", "none-active", "status: disabled, error");
    expect(err.message).toContain("switched off");
    expect(err.message).toContain("status: disabled, error");
  });

  it("only talks about limits when a limit was actually reached", () => {
    const err = new NoAvailableGoogleAccountError("user-1", "all-over-quota", "used/limit: 20/20");
    expect(err.message).toContain("daily limit");
    expect(err.message).toContain("20/20");
  });

  it("keeps the quota wording as the default, so old callers read the same", () => {
    expect(new NoAvailableGoogleAccountError("user-1").reason).toBe("all-over-quota");
  });
});
