import { randomUUID } from "node:crypto";
import type { VideoGenerationInput, VideoGenerationResult } from "../../types";
import { renderTemplate } from "@/core/prompt-engine/engine";
import { sceneVideoTemplate } from "@/core/prompt-engine/templates";
import { runGoogleFlowAutomation } from "@/core/automation/google-flow-driver";
import { AutomationCircuitBreakerError } from "@/core/automation/errors";

/**
 * Browser-automation-backed Google Flow video generation. Deliberately NOT registered in
 * core/ai/registry.ts — see docs/MOVIE-STUDIO-ROADMAP.md Module 4 — because it imports Playwright,
 * which must never end up in a Vercel serverless function's bundle. The only importer is
 * core/queue/processors/scene-video-auto.processor.ts, itself only reachable from worker.ts's own
 * processor registry, never the shared one the Vercel `/api/queue/tick` route uses.
 *
 * Falls back to the identical `manual_pending` shape `GoogleFlowVideoProvider` (the always-manual
 * provider) returns whenever automation circuit-breaks, so the rest of the pipeline — Scene state
 * machine, the hand-off upload UI — never has to know or care which path produced it.
 */
export async function generateVideoViaFlowAutomation(
  input: VideoGenerationInput,
  storageStateJson: string,
): Promise<VideoGenerationResult> {
  const durationSeconds = Math.min(8, Math.max(5, input.durationSeconds));
  const promptText = renderTemplate(input.templateOverride ?? sceneVideoTemplate, {
    action: input.action,
    camera: input.camera,
    lighting: input.lighting,
    emotion: input.emotion,
    durationSeconds: String(durationSeconds),
    style: input.style,
  });

  try {
    const result = await runGoogleFlowAutomation(storageStateJson, {
      promptText,
      characterReferenceImageUrls: input.characterReferenceImages.map((r) => r.url),
      durationSeconds,
    });
    return { status: "completed", data: result.videoBuffer, mimeType: result.mimeType, durationSeconds: result.durationSeconds };
  } catch (err) {
    if (err instanceof AutomationCircuitBreakerError) {
      return {
        status: "manual_pending",
        taskId: randomUUID(),
        promptText,
        instructions:
          `Browser automation couldn't finish this one (${err.reason.replace(/_/g, " ")}). ` +
          "Open Google Flow (labs.google/flow), paste this prompt with the attached character reference image(s), " +
          "generate a 5-8 second clip, download it, then upload it back here to continue the pipeline.",
      };
    }
    throw err; // a genuinely unexpected error (browser failed to launch, etc.) — let the job fail, BullMQ retries
  }
}
