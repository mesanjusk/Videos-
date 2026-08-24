import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";

let configured = false;

function ensureConfigured() {
  if (configured) return;
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error("Cloudinary is not configured — set CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET.");
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
  configured = true;
}

export interface UploadedAsset {
  url: string;
  publicId: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  bytes: number;
}

interface UploadOptions {
  folder: string;
  publicId?: string;
  resourceType: "image" | "video" | "raw"; // Cloudinary treats audio as "video"
}

function uploadBuffer(buffer: Buffer, opts: UploadOptions): Promise<UploadedAsset> {
  ensureConfigured();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: opts.folder,
        public_id: opts.publicId,
        resource_type: opts.resourceType,
        overwrite: true,
      },
      (error, result?: UploadApiResponse) => {
        if (error || !result) {
          reject(error ?? new Error("Cloudinary upload failed with no result"));
          return;
        }
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          width: result.width,
          height: result.height,
          durationSeconds: result.duration,
          bytes: result.bytes,
        });
      },
    );
    stream.end(buffer);
  });
}

/** Accepts either raw bytes or a provider-hosted URL (fetched first) and uploads to Cloudinary. */
export async function toBuffer(data: Buffer | string): Promise<Buffer> {
  if (Buffer.isBuffer(data)) return data;
  if (/^https?:\/\//.test(data)) {
    const res = await fetch(data);
    return Buffer.from(await res.arrayBuffer());
  }
  // otherwise assume base64
  return Buffer.from(data, "base64");
}

export async function uploadImageAsset(data: Buffer | string, opts: { folder: string; publicId?: string }): Promise<UploadedAsset> {
  const buffer = await toBuffer(data);
  return uploadBuffer(buffer, { ...opts, resourceType: "image" });
}

export async function uploadVideoAsset(data: Buffer | string, opts: { folder: string; publicId?: string }): Promise<UploadedAsset> {
  const buffer = await toBuffer(data);
  return uploadBuffer(buffer, { ...opts, resourceType: "video" });
}

export async function uploadAudioAsset(data: Buffer | string, opts: { folder: string; publicId?: string }): Promise<UploadedAsset> {
  const buffer = await toBuffer(data);
  return uploadBuffer(buffer, { ...opts, resourceType: "video" }); // Cloudinary has no distinct "audio" resource type
}

/** Signed params for a client-side upload widget — used for the Google Flow manual video hand-off (Stage 4). */
export function getSignedUploadParams(folder: string) {
  ensureConfigured();
  const timestamp = Math.round(Date.now() / 1000);
  const signature = cloudinary.utils.api_sign_request({ timestamp, folder }, process.env.CLOUDINARY_API_SECRET!);
  return { timestamp, folder, signature, apiKey: process.env.CLOUDINARY_API_KEY, cloudName: process.env.CLOUDINARY_CLOUD_NAME };
}

/**
 * Removes an asset from Cloudinary. Added for the merged storage abstraction's `delete()` and for
 * the cleanup policies described in docs/DEPLOYMENT.md — nothing in the original studio ever
 * deleted a remote asset, so intermediate uploads accumulated indefinitely.
 */
export async function deleteAsset(publicId: string, resourceType: "image" | "video" | "raw"): Promise<void> {
  ensureConfigured();
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
}
