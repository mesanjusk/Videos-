# AI Video Studio — Claude Code plugin

Drives the app's own PDF cartoon-workflow pipeline (`COMPLETE_AI_CARTOON_WORKFLOW_2026.pdf`) from
Claude Code, using only Google tools — exactly the same constraint the app itself is built under
(see `../ARCHITECTURE.md`):

- **API where one exists**: story/characters/backgrounds/scene images/voice/thumbnail all go through
  Gemini (`core/ai/providers/google/*`), via this plugin's MCP tools calling the app's REST API.
- **Human-like browser automation where no API exists**: Google Flow (Veo) has no public developer
  API — `generate_scene_video_auto` drives Flow's actual web UI with Playwright (open project,
  upload references, paste the prompt, generate, wait, download) instead of a human clicking through
  it, via `core/browser-automation-providers/google-flow` (Module 7B) on top of the app's
  provider-agnostic browser-automation framework (Module 7A). It degrades to the same manual
  hand-off a human would do (`generate_scene_video`) whenever automation hits something it
  shouldn't push through blindly — an expired session, a CAPTCHA, a changed selector — never a
  blind retry.
- **No non-Google tool, ever**: lip sync (Hedra/HeyGen/Kling) and music generation (Suno/Udio/
  Epidemic/Artlist) from the PDF are deliberately not wired in anywhere in this plugin — none of
  them are Google products, and the app itself leaves both as manual steps for the same reason.

This plugin is a thin orchestration layer. It never talks to Gemini, Veo, or any vendor directly —
every tool is a REST call into the app you already have running (locally or deployed), which owns
all of that.

## Setup

1. **Run the app** this plugin talks to (repo root): `npm install && npm run dev`, with
   `.env.local` filled in per the root `README.md` — at minimum a Gemini API key connected at
   `/accounts`. For the automated video step, also run `npm run worker` in a second terminal (needs
   `npx playwright install --with-deps chromium` once) and connect a Flow browser session at
   `/accounts`.
2. **Mint an API token**: sign in to the app, open **Settings → API tokens**, create one, and copy
   it — it's shown exactly once.
3. **Install this plugin's MCP server's dependencies**: `cd plugin/mcp-server && npm install`.
4. **Set environment variables** wherever you launch Claude Code from (shell profile, `.env`, or
   your terminal session):
   ```bash
   export CARTOON_APP_BASE_URL=http://localhost:3000   # or your deployed URL
   export CARTOON_API_TOKEN=cartoon_...                 # from step 2
   ```
5. **Load the plugin**: from the repo root, `claude --plugin-dir ./plugin`. Claude Code namespaces
   its skills under `ai-video-studio:` — e.g. `/ai-video-studio:run-pipeline a puppy who wants to fly a kite`.

## What's in here

```
.claude-plugin/plugin.json   plugin manifest
.mcp.json                    declares the bundled MCP server (stdio, ${CLAUDE_PLUGIN_ROOT}-relative)
mcp-server/                  the MCP server itself — 21 tools, one per REST endpoint the pipeline needs
  index.js
  lib/api-client.js          fetch wrapper (Bearer auth, job polling)
  lib/google-flow-task.js    mirrors src/core/browser-automation-providers/google-flow/build-task.ts
skills/                      one skill per PDF workflow step, plus run-pipeline (the full orchestrator)
```

## Not wired in yet

- **YouTube upload** (the PDF's final step) — the app's own YouTube Data API integration needs a
  verified OAuth consent screen configured in Google Cloud Console first; see
  `ARCHITECTURE.md` §12's "not done" list. Until then, download the rendered video/thumbnail from
  the app and upload manually.
- **Lip sync / music generation** — no Google product does either; both stay manual steps in the
  app's own UI, on purpose.
