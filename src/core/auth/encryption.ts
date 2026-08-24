/**
 * Historical import path. The implementation moved to `core/security/encryption.ts` during the
 * Browser Automation OS merge, where it was unified with that project's own AES-256-GCM helper —
 * see that file's comment for why both ciphertext layouts must stay readable.
 *
 * Kept as a re-export rather than updating every call site in one sweep: the accounts, Instagram
 * and browser-automation modules all import from here, and a mechanical rename across them would
 * have made the merge diff harder to review for no behavioural gain.
 */
export { encryptSecret, decryptSecret, encryptJSON, decryptJSON, redactSecrets } from "@/core/security/encryption";
