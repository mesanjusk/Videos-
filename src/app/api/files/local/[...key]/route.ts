import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";

/**
 * Serves an asset written by `LocalStorageProvider` (core/storage/local.ts) — the non-metered
 * storage path ZERO_COST mode needs. Ported from Project B, with two changes:
 *
 *  - Authenticated with this project's `requireUserId()` rather than Project B's session helper.
 *  - The containment check uses `path.relative` instead of `startsWith`. Project B's version
 *    accepted `<baseDir>-anything` as "inside" the base directory, because `"/srv/storage-evil"`
 *    does start with `"/srv/storage"`. That is a real traversal escape, not a style nit.
 *
 * Assets are per-deployment, not per-user: this route gates on being signed in, not on ownership,
 * because a storage key carries no user id. Anything genuinely sensitive belongs behind a signed
 * URL, not here.
 */
export const dynamic = "force-dynamic";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".json": "application/json",
  ".srt": "text/plain; charset=utf-8",
};

export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  try {
    await requireUserId();
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    throw err;
  }

  const { key } = await params;
  const baseDir = path.resolve(process.env.LOCAL_STORAGE_DIR ?? "./storage/local");
  const resolved = path.resolve(baseDir, key.join("/"));

  const relative = path.relative(baseDir, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const buffer = await readFile(resolved);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": MIME_TYPES[path.extname(resolved).toLowerCase()] ?? "application/octet-stream",
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
}
