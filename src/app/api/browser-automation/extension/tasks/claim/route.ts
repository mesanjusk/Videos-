import { NextResponse } from "next/server";
import { requireExtensionAuth, ExtensionUnauthorizedError } from "@/core/browser/extension-auth";
import { claimNextExtensionTask } from "@/modules/browser-automation/extension-service";
import { recordExtensionHeartbeat } from "@/core/browser/extension-presence";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const workerId = requireExtensionAuth(request);
    // Asking for work proves this extension is connected and claiming, which is exactly what the
    // image route needs to know before it enqueues a mission. Recorded here as well as on the
    // heartbeat endpoint so an extension built before the heartbeat still reads as present while it
    // is visibly doing the job. Never fails the claim — see recordExtensionHeartbeat.
    await recordExtensionHeartbeat(workerId, { via: "claim" });
    const body = await request.json().catch(() => ({}));
    const providerId = typeof body.providerId === "string" ? body.providerId : "google-flow";
    const run = await claimNextExtensionTask(workerId, providerId);
    if (!run) return NextResponse.json({ task: null });
    return NextResponse.json({ task: run });
  } catch (err) {
    if (err instanceof ExtensionUnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[extension/claim]", err);
    return NextResponse.json({ error: "Failed to claim browser task" }, { status: 500 });
  }
}
