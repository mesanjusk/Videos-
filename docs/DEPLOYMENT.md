# Deployment

For the click-by-click version — every variable, which dashboard it goes in, and how to operate the
system afterwards — see [OPERATIONS.md](./OPERATIONS.md). This document is the shape of it.

Two processes. The Next.js app on Vercel, the worker anywhere that stays running.

The split is not a preference — it is the constraint the whole architecture is built around.
Playwright, FFmpeg, HyperFrames and long renders cannot live in a serverless function, and
`src/core/queue/worker-only-processors.ts` is what keeps them out of the Vercel bundle. No route in
the deployed app can reach a Playwright import.

## Local

```bash
cp .env.example .env.local          # fill in NEXTAUTH_SECRET, ENCRYPTION_KEY, GEMINI_API_KEY
npm install
npm run infra:up                    # MongoDB + Redis in Docker
npx playwright install --with-deps chromium   # only if you need browser automation
npm run dev:all                     # app on :3000, worker on :4000
```

Generate the two keys with:

```bash
openssl rand -base64 32   # NEXTAUTH_SECRET
openssl rand -hex 32      # ENCRYPTION_KEY
```

`docker-compose.local.yml` provides MongoDB and Redis only. The app and worker run on the host
deliberately: `next dev` and `tsx watch` both want a fast file watcher, and Chromium and FFmpeg are
simpler to install once on the host than to rebuild into an image on every change.

Nothing about local development requires Vercel, Render, Cloudinary or any paid API. With
`STORAGE_PROVIDER=local` and a local LLM and image worker, it needs no external service at all.

Useful commands:

| | |
|---|---|
| `npm run dev` | app only |
| `npm run dev:worker` | worker only, watched |
| `npm run verify` | typecheck + lint + tests — run before pushing |
| `npm run infra:down` | stop MongoDB and Redis |

## Vercel (the app)

Import the repo; the defaults are correct (`npm run build`, output `.next`).

Environment: everything under APP, DATABASE, REDIS, AUTH, SECURITY, STORAGE and AI in
`.env.example`, plus:

```
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1   # Vercel only — the build never needs Chromium
CRON_SECRET=<openssl rand -hex 32>   # Vercel sends this as a bearer on its own cron requests
```

`STORAGE_PROVIDER=local` will not work here. Vercel's filesystem is read-only and ephemeral;
`LocalStorageProvider.isAvailable()` returns false rather than writing a file it cannot serve back.

`vercel.json` declares the daily cron backstop against `/api/queue/tick`. Daily is the Hobby plan
limit; the primary path is the in-process tick fired right after each enqueue, so jobs normally
start within a second or two.

## Render (the worker)

`render.yaml` is a Blueprint: **New → Blueprint**, point at the repo, fill in the `sync: false`
variables.

Two differences from the app's environment:

- Do **not** set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`. The build command installs Chromium here.
- `APP_BASE_URL` is where the worker reaches the *app*, not the worker's own URL.

`plan: starter`, deliberately. A free service spins down after ~15 minutes without HTTP traffic,
and a worker whose entire job is consuming queued work while nobody is looking is the worst
possible fit for that — a job enqueued at 3am waits until something wakes it.
`.github/workflows/keep-worker-warm.yml` narrows the gap to ten minutes if you must use the free
plan; it does not close it.

Any always-on host works: Railway, Fly.io, a VPS. It needs Node 20+, Chromium (`npx playwright
install --with-deps chromium`), and `npm run worker`.

## Verifying a deployment

```bash
curl https://<worker>/health
```

```json
{ "status": "ok", "workerId": "...", "uptimeSeconds": 412,
  "queues": ["story", "scene_image", "...", "automation_workflow"], "concurrency": 2 }
```

`automation_workflow`, `browser_task` and `scene_video_auto` must appear in `queues`. If they do
not, the worker is not registering the worker-only processors and browser jobs will sit queued
forever — visible on `/queue`, which is an honest degrade rather than a silent failure.

Then, in the app: **Create Video** → plan something → confirm the plan appears. That exercises the
queue, the gateway, MongoDB and Redis in one action.

## What can be turned off

Every integration added by the merge is off by default and independently switchable. A deployment
that sets only the `[required]` block in `.env.example` behaves exactly as it did before the merge.

## Rolling back

`git checkout pre-merge-checkpoint`. Data written by the merged code stays readable — new
collections are simply unused by the old code, new fields are optional, and ciphertext is written
in the layout the old code already reads. Data *in* the new collections will not be visible, since
the old app has no model for it.
