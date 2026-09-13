import { NextResponse } from "next/server";
import { requireExtensionAuth, ExtensionUnauthorizedError } from "@/core/browser/extension-auth";
import {
  recordExtensionHeartbeat,
  clearExtensionHeartbeat,
  EXTENSION_HEARTBEAT_TTL_SECONDS,
} from "@/core/browser/extension-presence";

export const dynamic = "force-dynamic";

/**
 * Where the Chrome extension says it is connected and taking missions.
 *
 * Separate from the claim endpoint on purpose, even though claiming also proves an extension is
 * alive: while a mission is running the extension stops claiming — one mission at a time, by its own
 * `running` guard — and a browser that is busy drawing an image is the last thing that should be
 * reported as absent. The heartbeat fires on the same alarm regardless of what the extension is
 * doing, so presence tracks the connection rather than the polling.
 *
 * `DELETE` is the extension switching claiming off. Waiting out the TTL would leave the image route
 * believing work will be collected for another minute and a half after the operator has said it
 * will not be.
 */
export async function POST(request: Request) {
  try {
    const workerId = requireExtensionAuth(request);
    const body = (await request.json().catch(() => ({}))) as { version?: unknown; userAgent?: unknown };
    // Recorded for display only — nothing branches on what an extension says about itself.
    const detail: Record<string, unknown> = {};
    if (typeof body.version === "string") detail.version = body.version.slice(0, 40);

    await recordExtensionHeartbeat(workerId, Object.keys(detail).length ? detail : undefined);
    return NextResponse.json({ ok: true, workerId, ttlSeconds: EXTENSION_HEARTBEAT_TTL_SECONDS });
  } catch (err) {
    if (err instanceof ExtensionUnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[extension/heartbeat]", err);
    return NextResponse.json({ error: "Failed to record the extension heartbeat" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    requireExtensionAuth(request);
    await clearExtensionHeartbeat();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ExtensionUnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[extension/heartbeat]", err);
    return NextResponse.json({ error: "Failed to clear the extension heartbeat" }, { status: 500 });
  }
}
