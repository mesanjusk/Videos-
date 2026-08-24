import { uploadImageAsset, uploadVideoAsset, uploadAudioAsset, deleteAsset } from "./cloudinary";
import type { AssetKind, StorageProvider, StoredAsset, UploadOptions } from "./types";

/**
 * The existing Cloudinary integration, behind the merged StorageProvider interface.
 *
 * `core/storage/cloudinary.ts` is deliberately left in place and unmodified apart from the added
 * `deleteAsset` — it is what every queue processor and the signed-upload-params routes already
 * call, and it carries the per-asset-kind `resource_type` handling plus the width/height/duration
 * passthrough that `core/quality/checks.ts` depends on. This class delegates to it rather than
 * reimplementing it (docs/MERGE-AUDIT.md §13).
 */
export class CloudinaryStorageProvider implements StorageProvider {
  readonly name = "cloudinary" as const;
  readonly isFree = false; // metered service — ZERO_COST must not route here (see core/cost)

  isAvailable(): boolean {
    return Boolean(
      process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET,
    );
  }

  async upload(data: Buffer | string, kind: AssetKind, options: UploadOptions): Promise<StoredAsset> {
    const opts = { folder: options.folder, publicId: options.publicId };
    const uploaded =
      kind === "image"
        ? await uploadImageAsset(data, opts)
        : kind === "audio"
          ? await uploadAudioAsset(data, opts)
          : await uploadVideoAsset(data, opts);

    return {
      provider: "cloudinary",
      url: uploaded.url,
      storageKey: uploaded.publicId,
      bytes: uploaded.bytes,
      width: uploaded.width,
      height: uploaded.height,
      durationSeconds: uploaded.durationSeconds,
    };
  }

  async delete(storageKey: string, kind: AssetKind): Promise<void> {
    await deleteAsset(storageKey, kind === "image" ? "image" : kind === "raw" ? "raw" : "video");
  }
}
