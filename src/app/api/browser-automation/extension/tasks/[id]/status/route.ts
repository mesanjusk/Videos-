import { NextResponse } from "next/server";
import { requireExtensionAuth, ExtensionUnauthorizedError } from "@/core/browser/extension-auth";
import { extensionTaskUpdateSchema } from "@/modules/browser-automation/schema";
import { updateExtensionTask } from "@/modules/browser-automation/extension-service";

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
    return NextResponse.json({ task: run });
  } catch (err) {
    if (err instanceof ExtensionUnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    console.error("[extension/status]", err);
    return NextResponse.json({ error: "Failed to update browser task" }, { status: 500 });
  }
}
