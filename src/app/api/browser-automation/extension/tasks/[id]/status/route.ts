import { NextResponse } from "next/server";
import { requireExtensionAuth, ExtensionUnauthorizedError } from "@/core/browser/extension-auth";
import { extensionTaskUpdateSchema } from "@/modules/browser-automation/schema";
import { updateExtensionTask } from "@/modules/browser-automation/extension-service";
import { wakeImageJobForRun } from "@/core/production/flow-image-wake";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workerId = requireExtensionAuth(request);
    const { id } = await params;
    const body = await request.json();
    const parsed = extensionTaskUpdateSchema.safeParse({ ...body, workerId });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid status update", issues: parsed.error.flatten() }, { status: 400 });
    }
    const run = await updateExtensionTask(id, parsed.data);
    if (!run) return NextResponse.json({ error: "Task not found or not owned by this extension" }, { status: 404 });

    // A mission that was generating an image has a job parked on it. Waking that job is best-effort
    // on purpose: the extension reported its work correctly either way, and failing its status
    // update because our side could not resume a job would make the extension retry the mission.
    let resumedJobId: string | null = null;
    if (parsed.data.stage === "completed" || parsed.data.stage === "failed") {
      resumedJobId = await wakeImageJobForRun(run).catch((err) => {
        console.error("[extension/status] could not resume the image job for this mission:", err);
        return null;
      });
    }

    return NextResponse.json({ task: run, resumedJobId });
  } catch (err) {
    if (err instanceof ExtensionUnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[extension/status]", err);
    return NextResponse.json({ error: "Failed to update browser task" }, { status: 500 });
  }
}
