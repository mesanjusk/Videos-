# AI Video Studio

Turns an idea into a finished cartoon video — story, characters, backgrounds, scenes, video, voice,
editing, thumbnail — guided end to end, with no prompt-writing required from the user.

Workflow logic follows `COMPLETE_AI_CARTOON_WORKFLOW_2026.pdf`; implementation technology follows the
approved stack (see `ARCHITECTURE.md` for the full rationale, especially why video generation is
architected as a **manual hand-off** through Google Flow rather than an API call).

## Status

This repository is being built in stages (see `ARCHITECTURE.md` §11 and the task list in the PR/commit
history). Stage 1 — the current commit — lays the foundation:

- Project scaffold (Next.js 15, TypeScript, Tailwind, App Router)
- `src/core/ai` — the provider-agnostic abstraction for story/image/video/voice generation
- `src/core/prompt-engine` — centralized, editable prompt templates seeded from the PDF's formulas
- `src/core/db` — MongoDB Atlas (Mongoose) connection + model registration
- `src/modules/*` — feature-based domain modules and their Mongoose models
- `src/modules/accounts` — the Google Account Manager (multi-account pooling, quota-aware rotation)

Not yet implemented: auth, dashboard UI, project wizard, queue processors, FFmpeg render pipeline,
and all page-level UI. See open tasks for the remaining stages.

## Getting started (once a stage adds runnable UI)

```bash
npm install
cp .env.example .env.local   # fill in MongoDB Atlas, Cloudinary, Upstash Redis, Google OAuth, Gemini
npm run dev
```

`npm run typecheck` and `npm run lint` are safe to run against the current stage's code at any point.

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — system design: provider abstraction, Google Account Manager,
  data model, API surface, queue-on-Vercel strategy, prompt engine, FFmpeg pipeline, folder structure.
- `docs/` — deeper references added alongside the stage that needs them (database schema, API
  reference, deployment guide).
