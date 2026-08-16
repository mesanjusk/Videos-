# Delivery Roadmap

Mirrors `ARCHITECTURE.md` §11. Each stage lands as its own commit on
`claude/video-studio-architecture-wruz2h` so the build is reviewable incrementally rather than as one
large diff.

- [x] **Stage 1 — Foundation.** Next.js 15/TS/Tailwind scaffold. `core/ai` provider abstraction
      (Story/Image/Video/Voice interfaces + registry). Gemini providers for story/image/voice. Google
      Flow video provider modeled as a manual hand-off (no public API exists). `core/prompt-engine`
      with the PDF's default templates. `core/db` Mongoose models: Project, Character, Background,
      Scene, Job, Asset, PromptTemplate, Settings. `modules/accounts` — the Google Account Manager,
      with AES-256-GCM credential encryption and a quota-aware round-robin selector.
- [x] **Stage 2 — Auth + dashboard shell + wizard.** NextAuth v5 Google OAuth (JWT session strategy,
      split edge-safe `auth.config.ts` from the Node-only `auth.ts` so `middleware.ts` never pulls in
      the MongoDB driver). Sidebar/topbar dashboard layout, dark/light theme (next-themes). Stats
      widgets wired to real DB queries (projects, recent videos, current jobs, storage, Google
      accounts, queue, recent activity) with empty states, not placeholder numbers. 4-step project
      creation wizard (Basics → Style → Story → Generate) with React Hook Form + Zod + Framer Motion
      step transitions. Google Account Manager UI (add/enable/disable/set-default/remove, paired with
      the ARCHITECTURE.md §3 two-step "OAuth-confirm-identity + paste AI Studio API key" flow).
      shadcn-style UI primitives hand-written against Radix (button, card, dialog, dropdown-menu,
      select, tabs, tooltip, etc.).
- [x] **Stage 3 — Story/Character/Background generation.** BullMQ queues (Upstash Redis) + the
      Vercel-serverless "poll and drain" worker runtime (`/api/queue/tick`, bounded time budget, hit
      by both Vercel Cron and a fire-and-forget self-call after enqueue for low latency — with an
      honest note that Vercel Hobby's cron frequency limit makes the self-call the real workhorse on
      free tier). Story/character/background generation wired end to end through the queue: enqueue →
      processor resolves a pooled Google account → calls the Gemini provider → uploads to Cloudinary →
      updates Project/Character/Background → Job status the UI polls. Quota errors mark the account
      `quota_exceeded` and let BullMQ's own retry pick a different pooled account on the next attempt.
      Character Library and Background Library UI with live generation status per card.
- [x] **Stage 4 — Scene Manager + scene image/video.** Story generation now auto-creates one `Scene`
      doc per story scene (Scene Planning, PDF step between Backgrounds and Images) so there's nothing
      to manually transcribe. Scene Manager cards: assign characters/background, generate/regenerate
      scene image, duplicate, delete. Scene video runs through the Google Flow manual hand-off end to
      end: generate assembles the Step-5 prompt + character references and parks the Job/Scene in
      `manual_pending`/`video_pending_manual` (denormalized onto the Scene too, so the hand-off panel
      survives a reload); the operator copies the prompt into Flow, then uploads the clip via a
      direct signed-Cloudinary-upload widget that completes the job. `withJobLifecycle` generalized to
      support this non-"completed" terminal state without touching the other processors.
- [x] **Stage 5 — Voice + render + thumbnail.** Gemini voice provider wired through the queue
      (per-scene dialogue, using the scene's primary character's voice profile when set). The FFmpeg
      compose pipeline (`core/ffmpeg/compose.ts`) — hand-verified against synthetic clips before being
      wired in (see the commit message and ARCHITECTURE.md §9): `xfade` transitions between scenes,
      a `zoompan` Ken Burns effect per clip, per-scene narration crossfaded (`acrossfade`) in sync with
      the video transitions (silence-filled where a scene has no voice), an optional music bed mixed
      under it, captions burned via the `subtitles`/libass filter (this build has no `drawtext`), an
      optional watermark overlay, exported 1080×1920/30fps/H.264. Swapped `@ffmpeg-installer/ffmpeg`
      for `ffmpeg-static` after discovering the former's pinned binary predates `xfade` entirely.
      Standalone `worker.ts` added as the non-serverless alternative — the honest answer to render
      jobs risking a serverless function's time limit. No music-*generation* provider: the brief's
      allowed list has no replacement for Suno/Udio/Epidemic/Artlist, so background music is a
      user-supplied upload instead of reaching for a forbidden or invented tool. Thumbnail generator
      produces the image plus a title/description/tags (composed from already-generated data, not an
      extra AI call). New Edit & Export page ties render, thumbnail, music upload, and watermark
      together.
- [x] **Stage 6 — Prompt Library, Settings, polish.** Prompt templates are now genuinely editable, not
      just displayed: every generation `Input` type carries an optional `templateOverride`, every
      Gemini/Google-Flow provider renders `templateOverride ?? <code default>`, and every processor
      resolves the user's DB-stored template (`modules/prompt-templates/service.ts`, seeded from
      `core/prompt-engine/templates/*.ts` on first access) before calling its provider — an edit in
      `/prompts` changes real output on the next generation, with a one-click reset back to the
      original text. Settings became interactive to match: per-capability provider overrides
      (`Settings.providerOverrides`, read by every processor via `getProviderOverride`), default
      language, and a live system-status panel (Mongo/Cloudinary/Redis configured or not). Polish
      pass: `loading.tsx` skeletons on every data-fetching route, a Framer Motion page-transition
      wrapper on the dashboard shell, and `HelpButton`s added to the two pages that were missing one
      (project detail, the wizard) — every screen now explains itself per the beginner-friendly UX
      requirement. `docs/database-schema.md`, `docs/api-reference.md`, and `docs/deployment.md` added,
      reflecting the schema/routes/ops story as actually built, not as originally planned.
- [x] **Module 7B + API tokens + Claude Code plugin.** The first real `ProviderAdapter` on Module 7A's
      browser-automation framework (`core/browser-automation-providers/google-flow`, ARCHITECTURE.md
      §17) — drives labs.google/flow generically instead of Module 4's hardcoded sequence, registered
      once at `worker.ts` startup, alongside a small justified extension to `ProviderAdapter.executeAction`
      so real download/screenshot paths reach `TaskResult` instead of a placeholder. `modules/api-tokens`
      (ARCHITECTURE.md §16) gives non-browser callers a `Bearer` credential — `requireUserId()` now
      checks it before falling back to the session cookie, with zero changes to any of the 60+ routes
      that call it, plus a Settings UI section to mint/revoke tokens. `plugin/` is a self-contained
      Claude Code plugin (21 MCP tools, one Skill per PDF workflow step + a `run-pipeline`
      orchestrator) that drives the whole pipeline through the app's REST API — Gemini via API,
      Google Flow via the automation above or a manual hand-off, and lip sync/music left as the
      honest manual steps they already were (no Google tool does either).
