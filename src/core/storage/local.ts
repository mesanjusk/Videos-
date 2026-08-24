import { mkdir, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { toBuffer, type AssetKind, type StorageProvider, type StoredAsset, type UploadOptions } from "./types";

/**
 * Local-disk storage, ported from Project B. This project previously had no storage path other
 * than Cloudinary, which made Cloudinary a hard requirement for generating anything at all —
 * see docs/MERGE-AUDIT.md §12. That is incompatible with ZERO_COST mode, where the point is that
 * a run must be able to complete without touching any metered service.
 *
 * Not usable on Vercel (read-only, ephemeral filesystem). It is for local development and for a
 * worker host with a persistent disk; `isAvailable()` reports honestly rather than failing at
 * upload time.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local" as const;
  readonly isFree = true;

  private readonly baseDir: string;
  private readonly publicBaseUrl: string;

  constructor(
    baseDir = process.env.LOCAL_STORAGE_DIR ?? "./storage/local",
    publicBaseUrl = process.env.APP_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000",
  ) {
    this.baseDir = path.resolve(baseDir);
    this.publicBaseUrl = publicBaseUrl.replace(/\/$/, "");
  }

  isAvailable(): boolean {
    // Vercel's filesystem is read-only apart from /tmp, and /tmp does not survive between
    // invocations — writing an asset there and handing out a URL to it would be a lie.
    return process.env.VERCEL !== "1";
  }

  async upload(data: Buffer | string, kind: AssetKind, options: UploadOptions): Promise<StoredAsset> {
    const buffer = await toBuffer(data);
    const folder = sanitizeSegment(options.folder);
    const name = `${Date.now()}-${randomUUID()}-${sanitizeSegment(options.publicId ?? options.fileName ?? kind)}`;
    const extension = EXTENSIONS[kind];
    const storageKey = `${folder}/${name}${extension}`;

    const fullPath = path.join(this.baseDir, storageKey);
    // Defence in depth: sanitizeSegment already strips separators, but an asset path is built from
    // caller-supplied strings, so confirm the resolved path really is inside baseDir before writing.
    if (!isInside(this.baseDir, fullPath)) throw new Error("Refusing to write outside the storage directory.");

    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, buffer);

    const dimensions = kind === "image" ? await measureImage(buffer) : {};
    return {
      provider: "local",
      url: `${this.publicBaseUrl}/api/files/local/${storageKey}`,
      storageKey,
      bytes: buffer.byteLength,
      ...dimensions,
    };
  }

  async delete(storageKey: string): Promise<void> {
    const fullPath = path.join(this.baseDir, storageKey);
    if (!isInside(this.baseDir, fullPath)) throw new Error("Refusing to delete outside the storage directory.");
    await rm(fullPath, { force: true });
  }
}

const EXTENSIONS: Record<AssetKind, string> = {
  image: ".png",
  video: ".mp4",
  audio: ".mp3",
  raw: "",
};

/** Strips anything that could escape the folder or confuse a filesystem, preserving "a/b" folders. */
function sanitizeSegment(value: string): string {
  return value
    .split("/")
    .map((part) => part.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "_"))
    .filter(Boolean)
    .join("/");
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** Local storage has no metadata service, so measure images ourselves — the quality checks need
 *  real dimensions, and sharp is already a dependency for the perceptual hash. */
async function measureImage(buffer: Buffer): Promise<{ width?: number; height?: number }> {
  try {
    const { width, height } = await sharp(buffer).metadata();
    return { width, height };
  } catch {
    return {};
  }
}
