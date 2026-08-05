import sharp from "sharp";

/**
 * Difference hash (dHash): resize to 9×8 grayscale, compare each pixel to its right neighbor —
 * cheap, robust to minor resizing/compression differences, good enough to catch a generation gone
 * badly wrong (blank frame, totally different subject). Not a claim of real perceptual/ML
 * similarity — see core/automation/selectors.ts-style honesty notes elsewhere in this codebase for
 * the same spirit: this is a structural heuristic, not vision-model consistency scoring, and it's
 * only ever used as a "warning", never to force a retry (checks.ts's checkImageResolution is the
 * only image check allowed to be "error" severity).
 */
export async function computeDHash(imageBuffer: Buffer): Promise<string> {
  const { data } = await sharp(imageBuffer).resize(9, 8, { fit: "fill" }).grayscale().raw().toBuffer({ resolveWithObject: true });

  let bits = "";
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const left = data[row * 9 + col] ?? 0;
      const right = data[row * 9 + col + 1] ?? 0;
      bits += left > right ? "1" : "0";
    }
  }
  // Store as hex for compactness.
  return BigInt("0b" + bits).toString(16).padStart(16, "0");
}

function hammingDistance(hashA: string, hashB: string): number {
  const a = BigInt("0x" + hashA);
  const b = BigInt("0x" + hashB);
  let xor = a ^ b;
  let distance = 0;
  while (xor > 0n) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  return distance;
}

/** 0 (nothing alike) to 1 (identical) — 64-bit dHash, so 64 total possible bit differences. */
export function dHashSimilarity(hashA: string, hashB: string): number {
  return 1 - hammingDistance(hashA, hashB) / 64;
}
