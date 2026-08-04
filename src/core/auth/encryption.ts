import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM at-rest encryption for pooled Google account API keys (ARCHITECTURE.md §3).
 * Never call this from client code — it must only run in server contexts (API routes, queue processors).
 */

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const hex = process.env.ACCOUNTS_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error("ACCOUNTS_ENCRYPTION_KEY must be a 64-char hex string (32 bytes) — generate with `openssl rand -hex 32`.");
  }
  return Buffer.from(hex, "hex");
}

/** Returns `iv:authTag:ciphertext`, each base64, colon-joined for storage as a single string field. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted secret.");
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}
