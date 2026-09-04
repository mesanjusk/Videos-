import { timingSafeEqual } from "node:crypto";

export class ExtensionUnauthorizedError extends Error {}

export function requireExtensionAuth(request: Request): string {
  const expected = process.env.BROWSER_EXTENSION_TOKEN;
  if (!expected) throw new ExtensionUnauthorizedError("BROWSER_EXTENSION_TOKEN is not configured");

  const supplied = request.headers.get("x-browser-extension-token") ?? "";
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
    throw new ExtensionUnauthorizedError("Invalid extension token");
  }

  const workerId = request.headers.get("x-browser-extension-worker")?.trim();
  if (!workerId) throw new ExtensionUnauthorizedError("Missing extension worker id");
  return workerId;
}
