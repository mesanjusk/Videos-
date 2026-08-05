import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { executeBrowserTaskSchema } from "@/modules/browser-automation/schema";
import { enqueueBrowserTask, listBrowserTaskRuns } from "@/modules/browser-automation/service";

export const dynamic = "force-dynamic";
// enqueueBrowserTask() runs a queue tick in-process via after() before this function is allowed to
// freeze, same budget as /api/queue/tick and /api/production-profiles/[id]/generate.
export const maxDuration = 60;

export async function GET() {
  try {
    const userId = await requireUserId();
    const runs = await listBrowserTaskRuns(userId);
    return NextResponse.json({ runs });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to list browser task runs" }, { status: 500 });
  }
}

/**
 * Execute Task: enqueues a `browser_task` Job on the existing Scene Queue plus its matching
 * `BrowserTaskRun`. With no provider registered yet (Module 7A ships zero adapters), the job will
 * fail immediately once picked up — an honest, visible failure on the Browser Automation Dashboard,
 * not a silent no-op. See docs/BROWSER-AUTOMATION-FRAMEWORK-PLAN.md §7/§8.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    const parsed = executeBrowserTaskSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    const result = await enqueueBrowserTask(userId, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to enqueue browser task" }, { status: 500 });
  }
}
