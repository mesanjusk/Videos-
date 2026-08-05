export interface FlowAutomationInput {
  promptText: string;
  characterReferenceImageUrls: string[];
  durationSeconds: number;
}

export interface FlowAutomationResult {
  videoBuffer: Buffer;
  mimeType: string;
  durationSeconds: number;
}
