import { headers } from "next/headers";
import { auth } from "./auth";
import { verifyApiToken } from "@/modules/api-tokens/service";

/**
 * Throws if unauthenticated — use in API routes / server actions that require a signed-in user.
 *
 * Accepts two credential shapes so the same 60+ route handlers work for both the browser (NextAuth
 * session cookie, via `auth()`) and non-browser callers like the Claude Code plugin's MCP server
 * (`Authorization: Bearer <token>`, a personal API token from modules/api-tokens). `headers()` reads
 * the current request's headers without any route handler needing to pass a `Request` through, so
 * this stays a drop-in change — no call site above it changes.
 *
 * A present-but-invalid Bearer header fails closed rather than falling back to the session check —
 * an explicit token attempt that doesn't verify should never silently succeed via an unrelated
 * cookie that happens to be on the same request.
 */
export async function requireUserId(): Promise<string> {
  const authHeader = (await headers()).get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const userId = await verifyApiToken(authHeader.slice("Bearer ".length).trim());
    if (!userId) throw new UnauthorizedError();
    return userId;
  }

  const session = await auth();
  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }
  return session.user.id;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "UnauthorizedError";
  }
}
