import { describe, it, expect, beforeAll } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret, encryptJSON, decryptJSON, redactSecrets, safeEqual } from "./encryption";

const KEY_HEX = "0".repeat(64);

beforeAll(() => {
  process.env.ENCRYPTION_KEY = KEY_HEX;
});

/** Reproduces Project B's concatenated layout so the dual-format reader is tested against a real
 *  payload of that shape rather than against our own writer. */
function encryptBosLayout(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(KEY_HEX, "hex"), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}

describe("encryption", () => {
  it("round-trips a secret", () => {
    expect(decryptSecret(encryptSecret("hunter2"))).toBe("hunter2");
  });

  it("writes the colon-joined layout so pre-merge code can still read it", () => {
    expect(encryptSecret("x").split(":")).toHaveLength(3);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("reads Project B's concatenated layout too", () => {
    expect(decryptSecret(encryptBosLayout("from-the-other-project"))).toBe("from-the-other-project");
  });

  it("round-trips JSON", () => {
    const value = { cookies: [{ name: "sid", value: "abc" }], origins: [] };
    expect(decryptJSON(encryptJSON(value))).toEqual(value);
  });

  it("rejects a tampered authentication tag", () => {
    const [iv, , ct] = encryptSecret("secret").split(":");
    const forgedTag = Buffer.alloc(16).toString("base64");
    expect(() => decryptSecret(`${iv}:${forgedTag}:${ct}`)).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("not-base64-at-all:x")).toThrow();
    expect(() => decryptSecret("c2hvcnQ=")).toThrow(/Malformed/);
  });

  it("handles unicode", () => {
    const text = "सेहरा — 60s रील";
    expect(decryptSecret(encryptSecret(text))).toBe(text);
  });
});

describe("redactSecrets", () => {
  it("replaces every occurrence", () => {
    expect(redactSecrets("token=abcd1234 and again abcd1234", ["abcd1234"])).toBe(
      "token=[REDACTED] and again [REDACTED]",
    );
  });

  it("ignores undefined and dangerously short secrets", () => {
    // Redacting a 1-3 character secret would shred unrelated text; leaving it is the lesser evil,
    // and such a value should never have been a secret in the first place.
    expect(redactSecrets("a in the message", ["a", undefined])).toBe("a in the message");
  });
});

describe("safeEqual", () => {
  it("compares equal and unequal values", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
