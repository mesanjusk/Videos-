// Thin REST client for the AI Video Studio app (see ../../../ARCHITECTURE.md and docs/api-reference.md).
// Every pipeline step this plugin exposes is one call through here — no Google/AI vendor SDK is
// used directly by the plugin itself, since the app already owns that (core/ai provider registry,
// Gemini text/image/voice; core/automation + core/browser-automation-providers/google-flow for
// video). This keeps the plugin a pure orchestration layer, matching how a human operator would
// drive the same app through its browser UI, just via MCP tool calls instead of clicks.

const BASE_URL = (process.env.CARTOON_APP_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const TOKEN = process.env.CARTOON_API_TOKEN;

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiRequest(method, path, body) {
  if (!TOKEN) {
    throw new Error(
      "CARTOON_API_TOKEN is not set. Sign in to the app, open Settings → API tokens, create one, " +
        "and set it as this plugin's CARTOON_API_TOKEN environment variable.",
    );
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const message = json?.error ? `${json.error}${json.issues ? ` — ${JSON.stringify(json.issues)}` : ""}` : `HTTP ${res.status}`;
    throw new ApiError(`${method} ${path} failed: ${message}`, res.status);
  }
  return json;
}

const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled", "manual_pending"]);

/**
 * Polls `GET /api/jobs/:id` until it reaches a terminal status or the timeout elapses. Every
 * enqueue-a-job route (story, character/background image, scene image/video/voice, render,
 * thumbnail, browser_task) returns 202 with just the job id — this is what turns that into
 * something a Claude Code skill can wait on and report back, the same way a human would watch the
 * Jobs/Queue dashboard.
 */
export async function waitForJob(jobId, { timeoutMs = 180_000, intervalMs = 3_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let job = (await apiRequest("GET", `/api/jobs/${jobId}`)).job;
  while (!TERMINAL_JOB_STATUSES.has(job.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    job = (await apiRequest("GET", `/api/jobs/${jobId}`)).job;
  }
  return job;
}
