import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalStorageProvider } from "./local";
import { getStorageProvider, __resetStorageProviders } from "./index";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "storage-test-"));
  __resetStorageProviders();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.STORAGE_PROVIDER;
  delete process.env.VERCEL;
});

describe("LocalStorageProvider", () => {
  it("writes a file and returns a resolvable key", async () => {
    const provider = new LocalStorageProvider(dir, "http://localhost:3000");
    const asset = await provider.upload(Buffer.from("hello"), "raw", { folder: "scenes", publicId: "clip" });

    expect(asset.provider).toBe("local");
    expect(asset.bytes).toBe(5);
    expect(asset.url).toBe(`http://localhost:3000/api/files/local/${asset.storageKey}`);
    expect(await readFile(path.join(dir, asset.storageKey), "utf8")).toBe("hello");
  });

  it("measures image dimensions, because the quality checks depend on real values", async () => {
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#000" } }).png().toBuffer();
    const asset = await new LocalStorageProvider(dir).upload(png, "image", { folder: "img" });
    expect(asset.width).toBe(64);
    expect(asset.height).toBe(48);
  });

  it("refuses to escape the base directory via the folder name", async () => {
    const provider = new LocalStorageProvider(dir);
    const asset = await provider.upload(Buffer.from("x"), "raw", { folder: "../../etc", publicId: "passwd" });
    // Traversal segments are neutralised rather than honoured — the file lands inside baseDir.
    expect(path.resolve(dir, asset.storageKey).startsWith(path.resolve(dir))).toBe(true);
    expect(asset.storageKey).not.toContain("..");
  });

  it("reports itself unavailable on Vercel, whose filesystem cannot serve an asset back", () => {
    process.env.VERCEL = "1";
    expect(new LocalStorageProvider(dir).isAvailable()).toBe(false);
  });

  it("deletes by storage key", async () => {
    const provider = new LocalStorageProvider(dir);
    const asset = await provider.upload(Buffer.from("bye"), "raw", { folder: "tmp" });
    await provider.delete(asset.storageKey);
    await expect(readFile(path.join(dir, asset.storageKey))).rejects.toThrow();
  });
});

describe("getStorageProvider", () => {
  it("defaults to cloudinary so the existing deployment is unaffected", () => {
    process.env.CLOUDINARY_CLOUD_NAME = "c";
    process.env.CLOUDINARY_API_KEY = "k";
    process.env.CLOUDINARY_API_SECRET = "s";
    expect(getStorageProvider().name).toBe("cloudinary");
  });

  it("honours STORAGE_PROVIDER=local", () => {
    process.env.STORAGE_PROVIDER = "local";
    expect(getStorageProvider().name).toBe("local");
  });

  it("prefers the free backend when asked and it is usable", () => {
    expect(getStorageProvider({ preferFree: true }).name).toBe("local");
  });

  it("does not divert to local for a free run when local cannot serve files", () => {
    process.env.VERCEL = "1";
    process.env.CLOUDINARY_CLOUD_NAME = "c";
    process.env.CLOUDINARY_API_KEY = "k";
    process.env.CLOUDINARY_API_SECRET = "s";
    expect(getStorageProvider({ preferFree: true }).name).toBe("cloudinary");
  });
});
