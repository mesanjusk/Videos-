import { randomUUID } from "node:crypto";
import type { VideoGenerationInput, VideoGenerationResult, VideoProvider } from "../../types";
import { renderTemplate } from "@/core/prompt-engine/engine";
import { sceneVideoTemplate } from "@/core/prompt-engine/templates";

/**
 * Google Flow has no public developer API — Veo is only reachable programmatically via Vertex AI,
 * and the project brief forbids Veo except when accessed through Flow's own (API-less) product.
 * So this provider does not call anything; it assembles the PDF Step-5 prompt and hands the task
 * to a human operator, who runs it in Flow's web UI and uploads the resulting clip back.
 *
 * The rest of the system (queue, Scene state machine, editor) is written against
 * `VideoGenerationResult`'s discriminated union and does not know or care that this one provider
 * is human-in-the-loop — swapping in a future API-backed provider (Veo via Vertex, once permitted,
 * or another approved service) requires no change outside this file.
 */
export class GoogleFlowVideoProvider implements VideoProvider {
  readonly id = "google-flow";
  readonly label = "Google Flow (manual)";
  readonly requiresManualHandoff = true;

  async generateVideo(input: VideoGenerationInput): Promise<VideoGenerationResult> {
    const promptText = renderTemplate(sceneVideoTemplate, {
      action: input.action,
      camera: input.camera,
      lighting: input.lighting,
      emotion: input.emotion,
      durationSeconds: String(Math.min(8, Math.max(5, input.durationSeconds))),
      style: input.style,
    });

    return {
      status: "manual_pending",
      taskId: randomUUID(),
      promptText,
      instructions:
        "Open Google Flow (labs.google/flow), paste this prompt with the attached character reference image(s), " +
        "generate a 5-8 second clip, download it, then upload it back here to continue the pipeline.",
    };
  }

  /**
   * Called once the operator uploads the Flow-generated clip via the signed Cloudinary widget
   * (POST /api/scenes/:id/video/upload). `uploadedUrl` is already a Cloudinary asset URL at that
   * point — this just closes out the hand-off task.
   */
  async completeManualUpload(_taskId: string, uploadedUrl: string): Promise<{ videoUrl: string; durationSeconds: number }> {
    return { videoUrl: uploadedUrl, durationSeconds: 8 };
  }
}
