import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { VideoGenerationInput, VideoGenerationResult } from "../../types";
import { renderTemplate } from "@/core/prompt-engine/engine";
import { sceneVideoTemplate } from "@/core/prompt-engine/templates";
import { runBrowserTask } from "@/core/browser/run-task";
import { buildGoogleFlowVideoTask } from "@/core/browser/providers/google-flow/build-task";

/**
 * Browser-automation-backed Google Flow video generation. Deliberately NOT registered in
 * core/ai/registry.ts — see docs/MOVIE-STUDIO-ROADMAP.md Module 4 — because it imports Playwright,
 * which must never end up in a Vercel serverless function's bundle. The only importer is
 * core/queue/processors/scene-video-auto.processor.ts, itself only reachable from worker.ts's own
 * processor registry, never the shared one the Vercel `/api/queue/tick` route uses.
 *
 * ## What the merge changed
 *
 * This used to call `core/automation/google-flow-driver.ts` — a second, Flow-specific Playwright
 * implementation living alongside the generic framework, with its own browser launch, its own
 * selector handling and its own circuit breaker. That file is gone. The same sequence now runs as
 * `TaskStep[]` through the one browser engine (`core/browser/`), which means this path picks up
 * self-healing selector resolution, the shared RecoveryEngine and the event bus for free, and
 * there is no longer a second way to drive Chromium in this codebase. See docs/MERGE-AUDIT.md §10.
 *
 * The externally visible behaviour is deliberately unchanged:
 *
 *  - A failure *at the site* (changed selector, verification challenge, a render that never
 *    finishes) degrades to the same `manual_pending` shape `GoogleFlowVideoProvider` returns, so
 *    the Scene state machine and the hand-off upload UI never learn which path produced it. This
 *    is what Module 4's AutomationCircuitBreakerError did.
 *  - A failure *before* the site (Chromium missing, browser wouldn't launch) throws, so the job
 *    fails and BullMQ retries it later rather than burning a human hand-off on a transient
 *    infrastructure problem. `TaskResult.failureStage` is what distinguishes the two.
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

  const { steps, metadata } = buildGoogleFlowVideoTask({
    promptText,
    referenceImageUrls: input.characterReferenceImages.map((r) => r.url),
    durationSeconds,
  });

  const result = await runBrowserTask({
    providerId: "google-flow",
    steps,
    metadata: metadata as unknown as Record<string, unknown>,
    storageStateJson,
  });

  if (result.state === "completed") {
    const downloaded = result.downloads[0];
    if (!downloaded) {
      // The run reported success but produced no file — treat as a site-side failure rather than
      // returning a "completed" result with nothing in it.
      return manualFallback(promptText, "the clip never downloaded");
    }
    return {
      status: "completed",
      data: await readFile(downloaded.path),
      mimeType: "video/mp4",
      durationSeconds,
    };
  }

  if (result.failureStage === "setup") {
    // Infrastructure, not the site. Let the job fail so the queue retries it.
    throw new Error(`Google Flow automation could not start a browser: ${result.error ?? "unknown error"}`);
  }

  return manualFallback(promptText, result.error ?? `the run ended in state "${result.state}"`);
}

function manualFallback(promptText: string, reason: string): VideoGenerationResult {
  return {
    status: "manual_pending",
    taskId: randomUUID(),
    promptText,
    instructions:
      `Browser automation couldn't finish this one (${reason}). ` +
      "Open Google Flow (labs.google/flow), paste this prompt with the attached character reference image(s), " +
      "generate a 5-8 second clip, download it, then upload it back here to continue the pipeline.",
  };
}
