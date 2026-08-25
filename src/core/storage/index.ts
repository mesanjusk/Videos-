import { CloudinaryStorageProvider } from "./cloudinary-provider";
import { LocalStorageProvider } from "./local";
import type { StorageProvider, StorageProviderName } from "./types";

export * from "./types";
export { CloudinaryStorageProvider } from "./cloudinary-provider";
export { LocalStorageProvider } from "./local";

const instances = new Map<StorageProviderName, StorageProvider>();

function instantiate(name: StorageProviderName): StorageProvider {
  let provider = instances.get(name);
  if (!provider) {
    provider = name === "local" ? new LocalStorageProvider() : new CloudinaryStorageProvider();
    instances.set(name, provider);
  }
  return provider;
}

/**
 * Resolves the storage backend for a run.
 *
 * The default is **cloudinary**, not local — the opposite of Project B's default and deliberate:
 * this application is deployed on Vercel today and every existing asset lives in Cloudinary, so a
 * merge that silently flipped the default would break the running deployment (Golden Rule 15).
 * `STORAGE_PROVIDER=local` opts in.
 *
 * `preferFree` is how ZERO_COST mode asks for a non-metered backend. It only diverts to local when
 * local is genuinely usable — on Vercel it is not, and the caller gets Cloudinary back plus an
 * honest answer from `isFree`, rather than an asset written to a directory that vanishes.
 */
export function getStorageProvider(opts: { preferFree?: boolean } = {}): StorageProvider {
  const configured = (process.env.STORAGE_PROVIDER as StorageProviderName | undefined) ?? "cloudinary";

  if (opts.preferFree) {
    const local = instantiate("local");
    if (local.isAvailable()) return local;
  }

  const provider = instantiate(configured === "local" ? "local" : "cloudinary");
  if (provider.isAvailable()) return provider;

  // Configured backend is unusable — fall back to the other one if it works, so a missing
  // Cloudinary key in local development degrades to disk instead of failing every job.
  const fallback = instantiate(provider.name === "local" ? "cloudinary" : "local");
  if (fallback.isAvailable()) {
    console.warn(`[storage] ${provider.name} is not configured — falling back to ${fallback.name}.`);
    return fallback;
  }
  return provider; // neither is available; let the upload throw with the provider's own message
}

/** Test-only: clears the memoised provider instances so env changes take effect. */
export function __resetStorageProviders(): void {
  instances.clear();
}
