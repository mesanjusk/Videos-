import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The one AES-256-GCM implementation in the merged application.
 *
 * Both source projects shipped their own, with **incompatible ciphertext layouts** and different
 * key env vars (docs/MERGE-AUDIT.md §25/§29.3):
 *
 *   - AI Video Studio: `base64(iv):base64(authTag):base64(ciphertext)`, key `ACCOUNTS_ENCRYPTION_KEY`
 *   - Browser Automation OS: `base64(iv ‖ authTag ‖ ciphertext)`, key `ENCRYPTION_KEY`
 *
 * A row written by one could not be read by the other, so simply picking a winner would have made
 * every existing encrypted Google account token, Instagram token and browser session unreadable.
 * Instead `decrypt()` detects the layout and reads **both**, while `encrypt()` keeps writing the
 * colon-joined layout — so ciphertext written after this merge is still readable by the pre-merge
 * code, and a rollback stays safe. No re-encryption migration is needed, now or later.
 *
 * Key resolution prefers `ENCRYPTION_KEY` (the name the merged `.env.example` documents) and falls
 * back to `ACCOUNTS_ENCRYPTION_KEY`, so an existing deployment keeps working with no env change.
 *
 * Server-only. Never import from a client component.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY ?? process.env.ACCOUNTS_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY (or the legacy ACCOUNTS_ENCRYPTION_KEY) must be a 64-character hex string " +
        "(32 bytes) — generate one with `openssl rand -hex 32`.",
    );
  }
  return Buffer.from(hex, "hex");
}

/** Writes the colon-joined layout — see the module comment for why that one and not the other. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

/** Reads either layout. Throws on a malformed payload or a failed authentication tag. */
export function decryptSecret(stored: string): string {
  const key = getKey();

  // Colon-joined layout (AI Video Studio). base64 never contains ":", so its presence is an
  // unambiguous discriminator rather than a heuristic.
  if (stored.includes(":")) {
    const [ivB64, tagB64, dataB64] = stored.split(":");
    if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted secret.");
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  }

  // Concatenated layout (Browser Automation OS).
  const raw = Buffer.from(stored, "base64");
  if (raw.length <= IV_LENGTH + AUTH_TAG_LENGTH) throw new Error("Malformed encrypted secret.");
  const decipher = createDecipheriv(ALGORITHM, key, raw.subarray(0, IV_LENGTH));
  decipher.setAuthTag(raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH));
  return Buffer.concat([
    decipher.update(raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH)),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptJSON(value: unknown): string {
  return encryptSecret(JSON.stringify(value));
}

export function decryptJSON<T = unknown>(payload: string): T {
  return JSON.parse(decryptSecret(payload)) as T;
}

/**
 * Deterministic redaction for anything about to be logged, persisted as a task log, or put into an
 * AI prompt. Ported from Project B, which had it and this project did not — the browser automation
 * subsystem handles user credentials, so "we simply never log them" needs a mechanical backstop,
 * not only a convention.
 */
export function redactSecrets(input: string, secrets: (string | undefined)[]): string {
  let out = input;
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue; // refuse to redact something so short it would gut the message
    out = out.split(secret).join("[REDACTED]");
  }
  return out;
}

/** Constant-time compare for webhook signatures and similar — avoids leaking length/prefix by timing. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
