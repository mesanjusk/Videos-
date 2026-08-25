/**
 * Provider-agnostic storage contract.
 *
 * The shape is Project B's `StorageProvider` (docs/MERGE-AUDIT.md §12/§30) widened with the three
 * fields this project's quality checks depend on — `width`, `height`, `durationSeconds`. Those are
 * not decoration: `core/quality/checks.ts#checkImageResolution` deliberately validates the
 * *measured* dimensions the storage backend reports rather than the generation provider's own
 * claim about what it produced. A provider that cannot measure returns them undefined, and the
 * check skips rather than treating "unknown" as "wrong".
 */

export type StorageProviderName = "cloudinary" | "local";

/** Cloudinary has no distinct audio type — it stores audio under "video". Callers say what they
 *  mean and each provider maps it to whatever its backend actually wants. */
export type AssetKind = "image" | "video" | "audio" | "raw";

export interface StoredAsset {
  provider: StorageProviderName;
  url: string;
  /** Provider-scoped identifier used to delete the asset later. Cloudinary public_id / local path. */
  storageKey: string;
  bytes: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

export interface UploadOptions {
  /** Logical folder, e.g. `characters/<id>` — providers prefix it however they need to. */
  folder: string;
  publicId?: string;
  /** Only used by providers that need a filename on disk; ignored by Cloudinary. */
  fileName?: string;
}

export interface StorageProvider {
  readonly name: StorageProviderName;
  /** True when uploads cost nothing beyond local disk — consulted by ZERO_COST routing. */
  readonly isFree: boolean;
  upload(data: Buffer | string, kind: AssetKind, options: UploadOptions): Promise<StoredAsset>;
  delete(storageKey: string, kind: AssetKind): Promise<void>;
  /** Whether this provider is usable right now (env configured, directory writable, ...). */
  isAvailable(): boolean;
}

/** Accepts raw bytes, a base64 string, or an http(s) URL to fetch. Shared by every provider. */
export async function toBuffer(data: Buffer | string): Promise<Buffer> {
  if (Buffer.isBuffer(data)) return data;
  if (/^https?:\/\//.test(data)) {
    const res = await fetch(data);
    if (!res.ok) throw new Error(`Failed to fetch asset from ${data}: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return Buffer.from(data, "base64");
}
