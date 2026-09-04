import { NextResponse } from "next/server";
import { requireExtensionAuth, ExtensionUnauthorizedError } from "@/core/browser/extension-auth";
import { claimNextExtensionTask } from "@/modules/browser-automation/extension-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const workerId = requireExtensionAuth(request);
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
