# AI Video Studio

Turns an idea into a finished cartoon video — story, characters, backgrounds, scenes, video, voice,
editing, thumbnail — guided end to end, with no prompt-writing required from the user.

Workflow logic follows `COMPLETE_AI_CARTOON_WORKFLOW_2026.pdf`; implementation technology follows the
approved stack (see `ARCHITECTURE.md` for the full rationale, especially why video generation is
architected as a **manual hand-off** through Google Flow rather than an API call — Flow has no public
API — and why there's no music-*generation* provider — none of the brief's allowed services offer one).

## Status

Built in six staged commits on `claude/video-studio-architecture-wruz2h` (see `docs/roadmap.md` for
what landed in each). All six are complete: auth, dashboard, the project wizard, story/character/
background/scene generation through a BullMQ queue, the Google Flow video hand-off, voice generation,
the FFmpeg render pipeline, thumbnail generation, the Google Account Manager, the editable Prompt
Library, and Settings.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in MongoDB Atlas, Cloudinary, Upstash Redis, Google OAuth
npm run dev
```

Then sign in and connect at least one Google account at `/accounts` (OAuth-confirm identity, then
paste a free Gemini API key from [AI Studio](https://aistudio.google.com/app/apikey)) — nothing
generates without one. See `docs/deployment.md` for the full production setup, including the two ways
to run the job queue (Vercel's serverless tick vs. the standalone `worker.ts`).

`npm run typecheck`, `npm run lint`, and `npm run build` are all clean against the current code.

## Instagram auto-reply

`/instagram` connects an Instagram professional account (via its linked Facebook Page) and
auto-replies to DMs it receives, drafted by Gemini and sent through Meta's official Messaging API —
never unsolicited outreach, which Meta's terms prohibit. See `ARCHITECTURE.md` §18 for the design
and `.env.example`'s Instagram section for the Meta app setup this needs (including App Review
before it can message real customers, done outside this codebase).

## Claude Code plugin

`plugin/` drives this same 10-step pipeline from Claude Code instead of the browser UI — one Skill
per PDF workflow step plus a `run-pipeline` orchestrator, authenticating with a personal API token
(mint one at Settings → API tokens) instead of a session cookie. See `plugin/README.md` for setup.

## Documentation

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — system design: provider abstraction, Google Account Manager,
  data model, API surface, queue-on-Vercel strategy, prompt engine, FFmpeg pipeline, folder structure.
- [`docs/database-schema.md`](./docs/database-schema.md) — every MongoDB collection, as actually shipped.
- [`docs/api-reference.md`](./docs/api-reference.md) — every route.
- [`docs/deployment.md`](./docs/deployment.md) — provisioning the free-tier services and deploying.
- [`docs/roadmap.md`](./docs/roadmap.md) — what landed in each of the six build stages.
