"use client";

import { useState } from "react";

export interface CloudinaryUploadResult {
  url: string;
  publicId: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  bytes?: number;
}

interface SignedUploadParams {
  timestamp: number;
  folder: string;
  signature: string;
  apiKey: string;
  cloudName: string;
}

/**
 * Client-side direct-to-Cloudinary upload using a signed-params route (the same pattern already used
 * for music/scene-video/lip-sync uploads — see core/storage/cloudinary.ts's getSignedUploadParams).
 * `paramsUrl` must point at a route that returns a SignedUploadParams JSON body.
 */
export function useCloudinaryUpload(paramsUrl: string, resourceType: "image" | "video" = "image") {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File): Promise<CloudinaryUploadResult | null> {
    setUploading(true);
    setError(null);
    try {
      const paramsRes = await fetch(paramsUrl);
      if (!paramsRes.ok) throw new Error("Couldn't prepare the upload");
      const { timestamp, folder, signature, apiKey, cloudName }: SignedUploadParams = await paramsRes.json();

      const formData = new FormData();
      formData.append("file", file);
      formData.append("api_key", apiKey);
      formData.append("timestamp", String(timestamp));
      formData.append("signature", signature);
      formData.append("folder", folder);

      const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`, {
        method: "POST",
        body: formData,
      });
      if (!uploadRes.ok) throw new Error("Upload to storage failed");
      const uploaded = await uploadRes.json();

      return {
        url: uploaded.secure_url,
        publicId: uploaded.public_id,
        width: uploaded.width,
        height: uploaded.height,
        durationSeconds: uploaded.duration,
        bytes: uploaded.bytes,
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      return null;
    } finally {
      setUploading(false);
    }
  }

  return { upload, uploading, error };
}
