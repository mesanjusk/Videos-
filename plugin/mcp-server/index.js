#!/usr/bin/env node
// MCP server for the "AI Video Studio" Claude Code plugin (plugin/README.md). Every tool below is a
// thin wrapper around the app's own REST API (docs/api-reference.md) — the plugin never talks to
// Gemini, Veo, or any other vendor directly. That keeps "only Google tools, API where available,
// human-like browser automation where it isn't" entirely the app's responsibility (core/ai's
// provider registry + core/browser-automation-providers/google-flow), and the plugin a pure
// orchestration layer on top, same as a human clicking through the web UI would be.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { apiRequest, waitForJob } from "./lib/api-client.js";
import { buildGoogleFlowVideoTask } from "./lib/google-flow-task.js";

const server = new McpServer({ name: "cartoon-workflow", version: "1.0.0" });

function json(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function jobResult(job) {
  return json({ job });
}

// ---- Projects --------------------------------------------------------------------------------

server.registerTool(
  "list_projects",
  { title: "List projects", description: "List this account's video projects.", inputSchema: {} },
  async () => json(await apiRequest("GET", "/api/projects")),
);

server.registerTool(
  "create_project",
  {
    title: "Create project",
    description:
      "Create a new cartoon video project (PDF workflow Step 0/1 setup). Starts in pipelineMode 'semi' " +
      "unless you set full_auto — see set_pipeline_mode to flip it once characters/backgrounds exist.",
    inputSchema: {
      title: z.string().min(2).max(120),
      premise: z.string().max(2000).describe("A one- or two-sentence idea for the story — Gemini expands this into the full scene-by-scene script."),
      language: z.string().min(2).default("en"),
      durationSeconds: z.number().int().min(15).max(600).default(60),
      targetPlatform: z.enum(["youtube", "instagram", "tiktok", "facebook"]).default("youtube"),
      style: z.enum(["Pixar", "Anime", "2D Cartoon", "Claymation", "Custom"]).default("Pixar"),
      customStyleDescription: z.string().max(500).optional(),
    },
    outputSchema: undefined,
  },
  async (input) =>
    json(
      await apiRequest("POST", "/api/projects", {
        title: input.title,
        premise: input.premise,
        storyInputMode: "idea",
        language: input.language,
        durationSeconds: input.durationSeconds,
        targetPlatform: input.targetPlatform,
        style: input.style,
        customStyleDescription: input.customStyleDescription,
      }),
    ),
);

server.registerTool(
  "get_project",
  { title: "Get project", description: "Fetch a project's current status/fields.", inputSchema: { projectId: z.string() } },
  async ({ projectId }) => json(await apiRequest("GET", `/api/projects/${projectId}`)),
);

server.registerTool(
  "set_pipeline_mode",
  {
    title: "Set pipeline mode",
    description:
      "'full' auto-chains scene image -> video -> voice -> lip sync (manual) -> render -> thumbnail " +
      "as soon as each prerequisite exists, once at least one character and one background are ready " +
      "(ARCHITECTURE.md §12). 'semi' (default) requires triggering each step yourself.",
    inputSchema: { projectId: z.string(), pipelineMode: z.enum(["full", "semi", "manual"]) },
  },
  async ({ projectId, pipelineMode }) => json(await apiRequest("PATCH", `/api/projects/${projectId}`, { pipelineMode })),
);

// ---- Step 1: Story -----------------------------------------------------------------------------

server.registerTool(
  "generate_story",
  {
    title: "Generate story (PDF Step 1)",
    description:
      "Runs the project's premise through Gemini using the PDF's exact 8-scene story prompt formula, then " +
      "auto-creates the project's Scene documents. Waits for the job to finish (or times out — poll with get_job).",
    inputSchema: { projectId: z.string(), waitMs: z.number().int().min(0).max(300_000).default(120_000) },
  },
  async ({ projectId, waitMs }) => {
    const { job } = await apiRequest("POST", `/api/projects/${projectId}/story`, {});
    return jobResult(waitMs > 0 ? await waitForJob(job._id, { timeoutMs: waitMs }) : job);
  },
);

// ---- Step 2: Characters -------------------------------------------------------------------------

server.registerTool(
  "list_characters",
  { title: "List characters", description: "List a project's characters.", inputSchema: { projectId: z.string() } },
  async ({ projectId }) => json(await apiRequest("GET", `/api/projects/${projectId}/characters`)),
);

server.registerTool(
  "create_character",
  {
    title: "Create character (PDF Step 2)",
    description:
      "Creates a character with the PDF's turnaround-sheet spec (age/body/face/eyes/hair/clothes/shoes/" +
      "accessories/personality) and enqueues Gemini image generation for the full pose sheet (front/side/" +
      "back/45°, happy/sad/angry/laughing, walking/running, white background).",
    inputSchema: {
      projectId: z.string(),
      name: z.string().min(1).max(60),
      age: z.string().max(60).optional(),
      bodyType: z.string().max(120).optional(),
      face: z.string().max(200).optional(),
      eyes: z.string().max(120).optional(),
      hair: z.string().max(120).optional(),
      clothes: z.string().max(200).optional(),
      shoes: z.string().max(120).optional(),
      accessories: z.string().max(200).optional(),
      personality: z.string().max(200).optional(),
      waitMs: z.number().int().min(0).max(300_000).default(120_000),
    },
  },
  async ({ projectId, waitMs, ...spec }) => {
    const { character, job } = await apiRequest("POST", `/api/projects/${projectId}/characters`, spec);
    const finalJob = waitMs > 0 ? await waitForJob(job._id, { timeoutMs: waitMs }) : job;
    return json({ character, job: finalJob });
  },
);

// ---- Step 3: Backgrounds ------------------------------------------------------------------------

server.registerTool(
  "list_backgrounds",
  { title: "List backgrounds", description: "List a project's backgrounds.", inputSchema: { projectId: z.string() } },
  async ({ projectId }) => json(await apiRequest("GET", `/api/projects/${projectId}/backgrounds`)),
);

server.registerTool(
  "create_background",
  {
    title: "Create background (PDF Step 3)",
    description: "Creates a background and enqueues Gemini image generation, following the PDF's background prompt formula (no characters, matching style/lighting).",
    inputSchema: {
      projectId: z.string(),
      name: z.string().min(1).max(60),
      description: z.string().min(3).max(500),
      lighting: z.string().max(60).default("morning"),
      waitMs: z.number().int().min(0).max(300_000).default(120_000),
    },
  },
  async ({ projectId, waitMs, ...spec }) => {
    const { background, job } = await apiRequest("POST", `/api/projects/${projectId}/backgrounds`, spec);
    const finalJob = waitMs > 0 ? await waitForJob(job._id, { timeoutMs: waitMs }) : job;
    return json({ background, job: finalJob });
  },
);

// ---- Scenes (Step 4 formula lives server-side in the prompt engine) ----------------------------

server.registerTool(
  "list_scenes",
  { title: "List scenes", description: "List a project's scenes with their character/background/asset links.", inputSchema: { projectId: z.string() } },
  async ({ projectId }) => json(await apiRequest("GET", `/api/projects/${projectId}/scenes`)),
);

server.registerTool(
  "update_scene",
  {
    title: "Update scene",
    description: "Assign characters/background to a scene, or edit camera/emotion/dialogue.",
    inputSchema: {
      sceneId: z.string(),
      characterIds: z.array(z.string()).optional(),
      backgroundId: z.string().optional(),
      camera: z.string().max(200).optional(),
      emotion: z.string().max(120).optional(),
      dialogue: z.string().max(2000).optional(),
    },
  },
  async ({ sceneId, ...patch }) => json(await apiRequest("PATCH", `/api/scenes/${sceneId}`, patch)),
);

server.registerTool(
  "generate_scene_image",
  {
    title: "Generate scene image",
    description: "Renders this scene's still frame via Gemini image, using the Step-4 formula (character reference + background + action + camera + emotion + lighting + style).",
    inputSchema: { sceneId: z.string(), waitMs: z.number().int().min(0).max(300_000).default(120_000) },
  },
  async ({ sceneId, waitMs }) => {
    const { job } = await apiRequest("POST", `/api/scenes/${sceneId}/image`, {});
    return jobResult(waitMs > 0 ? await waitForJob(job._id, { timeoutMs: waitMs }) : job);
  },
);

// ---- Step 5: Video (Google Flow — no public API, so this is the "act like a human" step) -------

server.registerTool(
  "generate_scene_video",
  {
    title: "Generate scene video — manual hand-off",
    description:
      "PDF Step 5. Google Flow (Veo) has no public API, so this always resolves to a manual hand-off: " +
      "the returned job carries the exact prompt to paste into labs.google/flow yourself, generate a " +
      "5-8s clip, download it, and upload it back via the app's Scene Manager. Prefer " +
      "generate_scene_video_auto if a Flow browser session is connected — same output, no human step.",
    inputSchema: { sceneId: z.string() },
  },
  async ({ sceneId }) => jobResult((await apiRequest("POST", `/api/scenes/${sceneId}/video`, {})).job),
);

server.registerTool(
  "generate_scene_video_auto",
  {
    title: "Generate scene video — browser automation (acts like a human)",
    description:
      "PDF Step 5, automated: Playwright drives labs.google/flow's actual web UI end to end (open " +
      "project, upload the character reference, paste the prompt, click generate, wait for the render, " +
      "download the clip) instead of a human doing it by hand — then uploads the result to the scene " +
      "automatically. Requires a Google account with a connected Flow browser session (see " +
      "list_google_accounts) and a running standalone worker process (npm run worker) — the job just " +
      "stays 'queued' otherwise. Falls back to the same manual hand-off as generate_scene_video if " +
      "automation hits something it can't push through blindly (session expired, CAPTCHA, selector " +
      "changed) — never guesses or retries blindly.",
    inputSchema: { sceneId: z.string(), waitMs: z.number().int().min(0).max(600_000).default(300_000) },
  },
  async ({ sceneId, waitMs }) => {
    const { job } = await apiRequest("POST", `/api/scenes/${sceneId}/video/auto`, {});
    return jobResult(waitMs > 0 ? await waitForJob(job._id, { timeoutMs: waitMs }) : job);
  },
);

server.registerTool(
  "run_google_flow_browser_task",
  {
    title: "Run an ad hoc Google Flow browser-automation task",
    description:
      "Generic Module 7A/7B entry point: drives labs.google/flow for an arbitrary prompt with no Scene " +
      "attached — useful for a one-off clip. Builds the same step sequence " +
      "GoogleFlowProviderAdapter interprets (navigate, upload references, paste prompt, generate, wait, " +
      "download) and enqueues it as a browser_task job. Prefer generate_scene_video_auto when you're " +
      "inside a project's normal pipeline — that path also files the result into the scene for you.",
    inputSchema: {
      promptText: z.string().min(1),
      referenceImageUrls: z.array(z.string().url()).default([]),
      durationSeconds: z.number().int().min(5).max(8).default(8),
      sessionId: z.string().optional().describe("BrowserSession id to restore (see list_browser_sessions); omit to run logged out."),
      projectId: z.string().optional(),
      waitMs: z.number().int().min(0).max(600_000).default(300_000),
    },
  },
  async ({ promptText, referenceImageUrls, durationSeconds, sessionId, projectId, waitMs }) => {
    const { steps, metadata } = buildGoogleFlowVideoTask({ promptText, referenceImageUrls, durationSeconds });
    const result = await apiRequest("POST", "/api/browser-automation/tasks", {
      providerId: "google-flow",
      sessionId,
      steps,
      metadata,
      projectId,
    });
    if (waitMs > 0) {
      const job = await waitForJob(result.jobId, { timeoutMs: waitMs });
      return json({ ...result, job });
    }
    return json(result);
  },
);

server.registerTool(
  "list_google_accounts",
  { title: "List Google accounts", description: "List the pooled Google accounts this app can generate with, and whether each has a Flow browser session connected.", inputSchema: {} },
  async () => json(await apiRequest("GET", "/api/accounts")),
);

server.registerTool(
  "list_browser_sessions",
  { title: "List browser-automation sessions", description: "List saved Playwright sessions (provider + label) available to run_google_flow_browser_task.", inputSchema: {} },
  async () => json(await apiRequest("GET", "/api/browser-automation/sessions")),
);

// ---- Step 6: Voice --------------------------------------------------------------------------

server.registerTool(
  "generate_voice",
  {
    title: "Generate voice (PDF Step 6)",
    description: "Generates narration audio for a scene's dialogue via Gemini TTS (400s if the scene has no dialogue).",
    inputSchema: { sceneId: z.string(), waitMs: z.number().int().min(0).max(300_000).default(120_000) },
  },
  async ({ sceneId, waitMs }) => {
    const { job } = await apiRequest("POST", `/api/scenes/${sceneId}/voice`, {});
    return jobResult(waitMs > 0 ? await waitForJob(job._id, { timeoutMs: waitMs }) : job);
  },
);

// Step 7 (lip sync) and Step 8 (music) are deliberately NOT exposed as tools here — no tool in the
// approved Google-only stack does either (see ARCHITECTURE.md §12/§9): lip sync has no free Google
// API (Hedra/HeyGen/Kling Lip Sync aren't Google), and no Google service generates music at all. Both
// stay human steps in the app's own UI, same as the PDF's own workflow describes them.

// ---- Step 9: Editing (FFmpeg, internal — not an external vendor) -------------------------------

server.registerTool(
  "render_project",
  {
    title: "Render final video (PDF Step 9)",
    description: "Composes every scene's clip + narration (+ optional uploaded music) into the final 1080x1920 H.264 video via the app's own FFmpeg pipeline — no external editor.",
    inputSchema: { projectId: z.string(), waitMs: z.number().int().min(0).max(600_000).default(300_000) },
  },
  async ({ projectId, waitMs }) => {
    const { job } = await apiRequest("POST", `/api/projects/${projectId}/render`, {});
    return jobResult(waitMs > 0 ? await waitForJob(job._id, { timeoutMs: waitMs }) : job);
  },
);

// ---- Step 10: Thumbnail --------------------------------------------------------------------

server.registerTool(
  "generate_thumbnail",
  {
    title: "Generate thumbnail (PDF Step 10)",
    description: "Generates a YouTube-style thumbnail via Gemini image, following the PDF's thumbnail prompt formula.",
    inputSchema: { projectId: z.string(), waitMs: z.number().int().min(0).max(300_000).default(120_000) },
  },
  async ({ projectId, waitMs }) => {
    const { job } = await apiRequest("POST", `/api/projects/${projectId}/thumbnail`, {});
    return jobResult(waitMs > 0 ? await waitForJob(job._id, { timeoutMs: waitMs }) : job);
  },
);

// ---- Jobs -----------------------------------------------------------------------------------

server.registerTool(
  "get_job",
  { title: "Get job", description: "Poll any job's current status — the target for every tool above that returns a job id.", inputSchema: { jobId: z.string() } },
  async ({ jobId }) => json(await apiRequest("GET", `/api/jobs/${jobId}`)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
