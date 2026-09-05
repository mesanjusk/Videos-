# AI Production OS

Turns an idea into a finished video — research, script, characters, backgrounds, scenes, video,
voice, editing, thumbnail — guided end to end, with no prompt-writing required from the user. And,
where a provider has no API, drives its website through browser automation instead of stopping.

Formed by merging two projects: the AI Video Studio (this repo) and Browser Automation OS. See
[`docs/MERGE-AUDIT.md`](docs/MERGE-AUDIT.md) for what each contributed and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the merged shape.

Workflow logic follows `COMPLETE_AI_CARTOON_WORKFLOW_2026.pdf`; implementation technology follows the
approved stack (see `ARCHITECTURE.md` for the full rationale, and why there's no music-*generation*
provider — none of the brief's allowed services offer one).

Google Flow, which makes the video, has **no public API**. So the browser automation engine drives
its website instead: it opens Flow in a real signed-in session, uploads the character references,
enters the prompt, waits for the render and downloads the MP4 straight back into the pipeline. That
is the default route, not a fallback — see [`docs/BROWSER-AUTOMATION.md`](docs/BROWSER-AUTOMATION.md).
A person only ever has to step in if the site run genuinely fails.

## Status

Built in six staged commits on `claude/video-studio-architecture-wruz2h` (see `docs/roadmap.md` for
what landed in each). All six are complete: auth, dashboard, the project wizard, story/character/
background/scene generation through a BullMQ queue, the Google Flow video hand-off, voice generation,
the FFmpeg render pipeline, thumbnail generation, the Google Account Manager, the editable Prompt
Library, and Settings.

## Getting started

```bash
npm install
cp .env.example .env.local          # fill in NEXTAUTH_SECRET, ENCRYPTION_KEY, GEMINI_API_KEY
npm run infra:up                    # MongoDB + Redis in Docker
npm run dev:all                     # app on :3000, worker on :4000
```

Nothing about local development requires Vercel, Render or Cloudinary. With `STORAGE_PROVIDER=local`
and a local LLM and image worker, it needs no external service at all — see
[`docs/ZERO-COST-MODE.md`](docs/ZERO-COST-MODE.md).

`npm run verify` runs typecheck, lint and the test suite.

Deploying? [`docs/OPERATIONS.md`](docs/OPERATIONS.md) is the runbook: every Vercel and Render
variable, first-run setup, daily operation and troubleshooting.

Then sign in and connect at least one Google account at `/accounts` (OAuth-confirm identity, then
paste a free Gemini API key from [AI Studio](https://aistudio.google.com/app/apikey)) — nothing
generates without one. See `docs/deployment.md` for the full production setup, including the two ways
to run the job queue (Vercel's serverless tick vs. the standalone `worker.ts`).

`npm run typecheck`, `npm run lint`, `npm test` and `npm run build` are all clean against the
current code.

## Making a video

One box, one button. `/create` takes a line — "A brave little turtle who learns to swim", or
"a 60-second Hindi Reel explaining the logic behind Sehra in Indian weddings" — and everything
after that happens on its own: story, cast, backgrounds, scene images, the Flow video run, voice,
the render and the thumbnail. The project page shows what is happening and, at the end, plays the
video with a download button under it.

Pipeline, spending policy, language and length are under `More options` with sensible defaults, and
`Review the plan before it starts` restores the two-step approve-first flow. See
[`docs/VIDEO-PIPELINE.md`](docs/VIDEO-PIPELINE.md).

Before the first run, `/accounts` needs two things once: a Google account with a Gemini key, and
that account's Google Flow browser session. The second is what lets video generation finish without
you.

## Cost policy

Every run has one: `ZERO_COST`, `FREE_PREFERRED`, `BALANCED` (the default) or `BEST_QUALITY`. Under
`ZERO_COST` the system refuses to run rather than falling back to a paid provider, and a provider
whose pricing cannot be verified counts as paid. See
[`docs/ZERO-COST-MODE.md`](docs/ZERO-COST-MODE.md) and
[`docs/PROVIDER-MATRIX.md`](docs/PROVIDER-MATRIX.md).

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
