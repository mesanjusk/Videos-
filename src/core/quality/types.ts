export interface QualityIssue {
  /** "error" issues are what QualityCheckFailedError is thrown for (AI-synchronous paths only,
   * see errors.ts) — they represent objectively wrong output. "warning" issues are advisory,
   * recorded and surfaced in the UI, never force a retry (e.g. subjective similarity, or a check
   * against a human-uploaded asset that isn't the AI's to redo). */
  severity: "error" | "warning";
  check: string;
  message: string;
}

export interface QualityCheckResult {
  passed: boolean;
  issues: QualityIssue[];
}
