import { randomUUID } from "node:crypto";
import type { LipSyncGenerationInput, LipSyncGenerationResult, LipSyncProvider } from "../../types";

/**
 * PDF Step 7 — Lip Sync. No approved-stack (free) provider exists: Hedra, HeyGen, and Kling Lip Sync
 * all require a paid API key this project doesn't have configured. Same shape as
 * `GoogleFlowVideoProvider`: assemble the hand-off (here, just "upload these two files"), return
 * `manual_pending`, and let the operator complete it via the matching upload route once they've run
 * it through one of those tools' web UI and downloaded the synced clip.
 */
export class ManualLipSyncProvider implements LipSyncProvider {
  readonly id = "manual";
  readonly label = "Manual (Hedra / HeyGen / Kling Lip Sync)";
  readonly requiresManualHandoff = true;

  async generateLipSync(_input: LipSyncGenerationInput): Promise<LipSyncGenerationResult> {
    return {
      status: "manual_pending",
      taskId: randomUUID(),
      instructions:
        "Open Hedra, HeyGen, or Kling Lip Sync. Upload the scene's video clip and its voice audio (both linked below), " +
        "generate the lip-synced clip, download it, then upload it back here.",
    };
  }

  async completeManualUpload(_taskId: string, uploadedUrl: string): Promise<{ videoUrl: string; durationSeconds: number }> {
    return { videoUrl: uploadedUrl, durationSeconds: 8 };
  }
}
