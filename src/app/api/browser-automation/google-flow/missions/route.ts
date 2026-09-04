import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, UnauthorizedError } from "@/core/auth/session";
import { buildGoogleFlowExtensionMission } from "@/core/browser/providers/google-flow/build-extension-mission";
import { enqueueExtensionBrowserTask } from "@/modules/browser-automation/extension-service";

export const dynamic = "force-dynamic";

const assetSchema = z.object({
  url: z.string().url(),
  fileName: z.string().min(1).max(255).optional(),
  mimeType: z.string().min(1).max(120).optional(),
});

const missionSchema = z.object({
  projectId: z.string().optional(),
  outputFileName: z.string().min(1).max(255).optional(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
  language: z.string().min(1).max(80).default("Hindi"),
  sharedAssets: z.array(assetSchema).default([]),
  scenes: z.array(z.object({
    id: z.string().min(1),
    prompt: z.string().min(1),
    referenceAssets: z.array(assetSchema).optional(),
  })).min(1),
});

/**
 * Production-engine handoff: accepts already-planned scenes. No Gemini call happens here; it only
 * serializes the scene plan into deterministic extension actions and queues it for Chrome.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const parsed = missionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid Flow mission", issues: parsed.error.flatten() }, { status: 400 });
    }

    const task = buildGoogleFlowExtensionMission({ taskId: "assigned-on-enqueue", ...parsed.data });
    const result = await enqueueExtensionBrowserTask(userId, {
      providerId: task.providerId,
      projectId: parsed.data.projectId,
      steps: task.steps,
      metadata: task.metadata,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error("[google-flow/missions]", err);
    return NextResponse.json({ error: "Failed to enqueue Google Flow mission" }, { status: 500 });
  }
}
