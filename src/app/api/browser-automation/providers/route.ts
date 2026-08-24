import { NextResponse } from "next/server";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { upsertBrowserProviderConfigSchema } from "@/modules/browser-automation/schema";
import { listBrowserProviderConfigs, upsertBrowserProviderConfig } from "@/modules/browser-automation/service";
import { browserProviderRegistry } from "@/core/browser/provider-adapter";

export const dynamic = "force-dynamic";

/** "Provider Status" for the dashboard: which adapters are actually registered in this deployment's
 * worker process (empty in Module 7A — deliberately, see docs/BROWSER-AUTOMATION-FRAMEWORK-PLAN.md
 * §7/§8) alongside this user's saved per-provider config rows. */
export async function GET() {
  try {
    const userId = await requireUserId();
    const [configs, registered] = await Promise.all([
      listBrowserProviderConfigs(userId),
      Promise.resolve(browserProviderRegistry.list().map((a) => ({ id: a.id, label: a.label }))),
    ]);
    return NextResponse.json({ configs, registered });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to list providers" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await request.json();
    const parsed = upsertBrowserProviderConfigSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input", issues: parsed.error.flatten() }, { status: 400 });

    const config = await upsertBrowserProviderConfig(userId, parsed.data);
    return NextResponse.json({ config }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: "Failed to save provider config" }, { status: 500 });
  }
}
