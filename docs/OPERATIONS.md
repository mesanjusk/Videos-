# Operations runbook

Everything you have to set by hand, where it goes, and how to run the system once it is up.

`docs/DEPLOYMENT.md` covers the shape of the deployment. This is the click-by-click version.

---

## 0. Before you touch a dashboard

Generate the two secrets. Keep them somewhere you will not lose them — one of them cannot be
rotated without data loss.

```bash
openssl rand -base64 32   # NEXTAUTH_SECRET
openssl rand -hex 32      # ENCRYPTION_KEY   ← 64 hex characters exactly
openssl rand -hex 32      # CRON_SECRET
```

> **`ENCRYPTION_KEY` is not rotatable.** It encrypts every stored Google token, Instagram token,
> browser session and workflow credential. Change it and every existing row becomes permanently
> unreadable — there is no recovery path, by design. Store it in a password manager now.

You also need accounts for:

| Service | Free tier enough to start? | What you get from it |
|---|---|---|
| MongoDB Atlas | Yes (M0) | `MONGODB_URI` |
| Upstash Redis | Yes | `REDIS_URL` |
| Cloudinary | Yes | cloud name, API key, API secret |
| Google Cloud Console | Yes | OAuth client ID + secret |
| Google AI Studio | Yes | `GEMINI_API_KEY` |
| Vercel | Yes (Hobby) | the app |
| Render | **No — use Starter (~$7/mo)** | the worker. See §3 for why free does not work |

---

## 1. Provider prerequisites

### MongoDB Atlas

1. Create a free **M0** cluster.
2. **Database Access** → add a user with *Read and write to any database*.
3. **Network Access** → add `0.0.0.0/0`. Vercel and Render both use dynamic egress IPs, so an
   allowlist of specific addresses will break intermittently and confusingly.
4. **Connect** → *Drivers* → copy the SRV string. Append your database name:

```
mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/ai-production-os?retryWrites=true&w=majority
```

URL-encode the password if it contains `@ : / ? # [ ] %`.

### Upstash Redis

Create a database, copy the **`rediss://`** URL (TLS — note the double `s`). The code already sets
`enableReadyCheck: false`, which Upstash needs.

### Cloudinary

Dashboard → Product Environment Credentials → cloud name, API key, API secret.

### Google OAuth (app sign-in)

1. Google Cloud Console → **APIs & Services → OAuth consent screen**. External. Add your own email
   under *Test users* while it is unpublished, or nobody can sign in.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
3. Authorised redirect URIs — add **both**, exactly:
   ```
   http://localhost:3000/api/auth/callback/google
   https://YOUR-APP.vercel.app/api/auth/callback/google
   ```
4. Copy client ID and secret.

A wrong or missing redirect URI is the single most common setup failure. It presents as
`redirect_uri_mismatch` on sign-in.

### Gemini API key

[aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) → create key.

This one is a **deployment-wide fallback for development**. In normal operation each connected
Google account carries its own encrypted key (§5.1), which is what lets quota rotate across
accounts.

---

## 2. Vercel — the app

**Import the repo.** Framework preset Next.js; build command, output directory and install command
are all correct by default. Do not override them.

### Environment variables

Set every one of these for **Production, Preview and Development** unless noted.

#### Required — the app will not work without these

| Variable | Value |
|---|---|
| `NEXTAUTH_URL` | `https://YOUR-APP.vercel.app` — no trailing slash |
| `NEXTAUTH_SECRET` | the `openssl rand -base64 32` value |
| `MONGODB_URI` | Atlas SRV string |
| `REDIS_URL` | Upstash `rediss://` URL |
| `ENCRYPTION_KEY` | the 64-hex value |
| `GOOGLE_CLIENT_ID` | from OAuth client |
| `GOOGLE_CLIENT_SECRET` | from OAuth client |
| `CLOUDINARY_CLOUD_NAME` | |
| `CLOUDINARY_API_KEY` | |
| `CLOUDINARY_API_SECRET` | |

#### Vercel-specific — these belong here and nowhere else

| Variable | Value | Why |
|---|---|---|
| `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | `1` | The app build never needs Chromium; no route can reach a Playwright import. **Do not set this on Render.** |
| `CRON_SECRET` | the third `openssl` value | Vercel injects `Authorization: Bearer $CRON_SECRET` on its own cron requests when a var of this exact name exists. Without it, `/api/queue/tick` returns 401 to everyone including Vercel. |
| `APP_BASE_URL` | same as `NEXTAUTH_URL` | Used to build asset URLs |

#### Recommended

| Variable | Value |
|---|---|
| `STORAGE_PROVIDER` | `cloudinary` — **`local` cannot work on Vercel** (read-only, ephemeral filesystem) |
| `GEMINI_API_KEY` | your AI Studio key |
| `DEFAULT_COST_POLICY` | `BALANCED` |
| `QUEUE_TICK_BUDGET_MS` | `45000` on Hobby. On Pro you may raise it — keep it below `maxDuration` in `src/app/api/queue/tick/route.ts` (currently 60s) so the tick closes its workers before the platform kills the function |

#### Feature flags — set the same values on Render (§3)

```
ENABLE_ZERO_COST_MODE=true
ENABLE_OMNIROUTE=false
ENABLE_VOICEBOX=false
ENABLE_HYPERFRAMES=false
ENABLE_IDEOGRAM=false
ENABLE_LOCAL_AI=false
ENABLE_BROWSER_FALLBACK=true
```

> **These must match between Vercel and Render.** The app is what shows a user their options; the
> worker is what runs them. A mismatch means the UI offers a provider the worker will refuse, or
> hides one it would happily use.

#### Optional — only if you use these features

Instagram auto-reply: `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET`, `INSTAGRAM_REDIRECT_URI`
(`https://YOUR-APP.vercel.app/api/instagram/callback`), `INSTAGRAM_WEBHOOK_VERIFY_TOKEN`.

Optional providers: `IDEOGRAM_API_KEY`, `VOICEBOX_URL`, `OMNIROUTE_BASE_URL`, `LOCAL_AI_*`,
`HYPERFRAMES_URL` — each with its flag turned on.

### After the first deploy

Go back to the Google OAuth client and confirm the production redirect URI matches the real
deployment URL. If Vercel gave you a different domain than you guessed, fix it now.

---

## 3. Render — the worker

The worker runs everything a serverless function must not: Playwright, FFmpeg, HyperFrames, long
renders, and the schedule sweeper.

**New → Blueprint → point at the repo.** `render.yaml` is already in the tree and defines the
service; you only fill in the `sync: false` values.

If you prefer to create it manually: **New → Web Service**, runtime Node,
build `npm ci && npx playwright install --with-deps chromium`, start `npm run worker`,
health check path `/health`.

### Environment variables

**Same value as Vercel, byte-identical:**

```
MONGODB_URI
REDIS_URL
ENCRYPTION_KEY          ← the worker decrypts what the app encrypted
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
STORAGE_PROVIDER
GEMINI_API_KEY
DEFAULT_COST_POLICY
ENABLE_*                ← all seven flags, matching
```

**Worker-only:**

| Variable | Value |
|---|---|
| `NODE_VERSION` | `20` |
| `APP_BASE_URL` | `https://YOUR-APP.vercel.app` — where the worker reaches the **app**, not its own URL |
| `WORKER_CONCURRENCY` | `2`. Lower to `1` on a small instance; browser runs are memory-hungry |
| `PLAYWRIGHT_HEADLESS` | `true` |
| `MAX_AI_ACTIONS` | `100` — the kill switch against a runaway AI agent loop |
| `AI_ALLOWED_DOMAINS` | comma-separated domains the AI agent may navigate to. **Empty means no allowlist.** Set it in production |

**Deliberately NOT on Render:**

`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` (the build installs Chromium here — setting it breaks every
browser job), `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `CRON_SECRET`, `INSTAGRAM_*`. Nothing
reachable from `worker.ts` reads any of them; it has no HTTP surface beyond `/health` and never
authenticates a user.

### Why not the free plan

A free Render service spins down after ~15 minutes without HTTP traffic. A worker whose entire job
is consuming queued work while nobody is looking is the worst possible fit for that — a job
enqueued at 3am waits until something wakes the service.

`.github/workflows/keep-worker-warm.yml` pings `/health` every ten minutes if you must use free
(set a `WORKER_HEALTH_URL` repo secret and enable the workflow). It narrows the gap; it does not
close it. Treat free as a testing arrangement.

---

## 4. Verifying the deployment

### Worker

```bash
curl https://YOUR-WORKER.onrender.com/health
```

```json
{ "status": "ok", "workerId": "...", "uptimeSeconds": 412,
  "queues": ["story", "...", "automation_workflow", "browser_task", "scene_video_auto"],
  "concurrency": 2 }
```

**Check `queues` contains `automation_workflow`, `browser_task` and `scene_video_auto`.** If it does
not, the worker is not registering the worker-only processors, and browser jobs will sit queued
forever — visible on `/queue`, which is an honest degrade rather than a silent failure.

### App

Sign in at `https://YOUR-APP.vercel.app`. Then **Create Video** → type one line → *Plan this video*.
That single action exercises Auth.js, MongoDB, Redis, BullMQ, the AI gateway and the queue tick. If
a plan appears, the stack is wired correctly.

---

## 5. First-run setup inside the app

### 5.1 Connect a Google generation account — do this first

**`/accounts`** → *Add account*. Confirm identity via OAuth, then paste a Gemini API key from
[AI Studio](https://aistudio.google.com/app/apikey).

**Nothing generates until at least one account is connected.** These are a *pool*: each carries its
own encrypted key and quota, and when one hits its limit the next job automatically rotates to
another. `GEMINI_API_KEY` in the environment is only a development fallback.

Add two or three accounts if you plan to generate at volume.

### 5.2 Optional — connect a Google Flow browser session

Only needed for browser-automated video generation.

Flow has no public API, so the operator signs in once by hand and hands the app the resulting
session:

```js
// Run locally, with Playwright installed
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext();
await ctx.newPage().then(p => p.goto("https://labs.google/flow"));
// → sign in manually in the window that opened, then:
console.log(JSON.stringify(await ctx.storageState()));
```

Paste that JSON into `/accounts` → the account → *Connect Flow session*. It is stored AES-256-GCM
encrypted and only ever read by the worker.

Sessions expire. When automation reports `session_expired`, redo this.

### 5.3 Review Settings

**`/settings`** — per-capability provider choice, language default, and API tokens for the Claude
Code plugin. A token is shown **once**; copy it immediately.

### 5.4 Optional — create a Production Profile

**`/production-profiles`** — a saved configuration: characters, style pack, voice pack, scene
count, quality thresholds, renderer, cost policy. Useful when you make the same *kind* of video
repeatedly. Not required; Create Video works without one.

---

## 6. Daily operation

### Making a video — the short path

1. **`/create`** → describe it in one line.
   *"Create a 60-second Hindi Instagram Reel explaining the logic behind Sehra in Indian weddings."*
2. Optionally set pipeline, cost policy, language, duration. Leave them alone and it infers.
3. **Plan this video.** Takes a few seconds — a model call.
4. **Read the plan.** Scenes, script beats, research questions, assets, voice, renderer. If the
   director corrected anything (duration rescaled, language forced) it says so in an amber box.
5. **Approve and start** — or **Discard**. Nothing is generated and nothing is spent until you
   approve.
6. Watch **`/production`** (Pipeline Monitor) or **`/queue`**.

### Making a video — the manual path

`/projects/new` → wizard → generate story → characters → backgrounds → scenes → render. Every step
is user-triggered. Set a project to `full` pipeline mode to have the orchestrator chain the steps
automatically instead.

### Where to look when something is running

| Page | Shows |
|---|---|
| `/queue` | Every job, cross-project, filterable by status |
| `/production` | Production runs and their current stage |
| `/projects/[id]` | One project's scenes, assets and history |
| `/browser-automation` | Browser task runs with step-by-step logs |
| `/workflows` | Workflows, automations, scheduled runs |

### Job states, and what each means

| State | Meaning | Do |
|---|---|---|
| `queued` | Waiting for a worker | Nothing, unless it stays there — see §7 |
| `running` | In progress | Nothing |
| `retrying` | Failed, backing off before another attempt | Nothing; BullMQ handles it |
| `manual_pending` | Needs a person — no API route exists | Follow the instructions on the scene |
| `failed` | All attempts exhausted | Read `error`, fix, re-trigger |
| `cancelled` | Cancelled before it started | — |

### The manual hand-off

Video generation drives Google Flow's website, because Flow has no API. That needs two things: the
worker running (Playwright cannot run on Vercel) and a Google account with a connected Flow browser
session. Given both, a scene goes from prompt to downloaded MP4 without you.

Missing either, the scene parks with a prompt for you instead: open the site, paste the prompt,
generate, download, upload the result back — and the pipeline resumes automatically. The same
hand-off is what happens if the site run fails, so the worst case is always "you do it yourself",
never a lost job.

Lip-sync has no automatic provider at all and is skipped rather than parked — see
[PROVIDER-MATRIX.md](./PROVIDER-MATRIX.md). Run it by hand on a scene if you want it.

---

## 7. Troubleshooting

**Jobs stay `queued` forever.**
The worker is down or not registering worker-only processors. Check `/health` and its `queues`
array. On Render free, it is probably asleep.

**`redirect_uri_mismatch` on sign-in.**
The OAuth client's authorised redirect URI does not exactly match
`https://YOUR-APP.vercel.app/api/auth/callback/google`. No trailing slash, correct protocol.

**Everything fails with a decryption error after a redeploy.**
`ENCRYPTION_KEY` differs between the app and the worker, or was changed. It must be byte-identical
in both, and it cannot be rotated without losing the data it protects.

**`No provider for "image" is available under cost policy ZERO_COST`.**
Working as intended — nothing free is configured for that capability. The error names every
candidate and why it was rejected. Either configure a free provider (`docs/ZERO-COST-MODE.md`) or
use a different policy.

**A browser job fails with `session_expired`.**
Redo §5.2.

**A browser job fails on a selector.**
Google Flow's DOM is not a documented contract and the shipped selectors are unverified
placeholders. Recalibrate with `npx playwright codegen labs.google/flow` against a real signed-in
session and edit `src/core/browser/providers/google-flow/selectors.ts`. The self-healing resolver
means one broken selector no longer breaks the whole run.

**Quality checks keep failing a render.**
Read the `qualityIssues` on the job. Errors trigger a retry of the stage that owns the fault (a
black clip → video generation, not render). Warnings are recorded and never retried.

**Cloudinary quota exhausted.**
Switch the worker to `STORAGE_PROVIDER=local` with a Render persistent disk, or clean up. Vercel
cannot use local storage.

---

## 8. Routine maintenance

| Cadence | Task |
|---|---|
| Weekly | Skim `/queue` for stuck `manual_pending` scenes nobody actioned |
| Weekly | Check Cloudinary usage |
| Monthly | Check Google account quotas at `/accounts`; reactivate any parked ones |
| Monthly | Review the audit log for credential reads you do not recognise |
| On a provider change | Re-check `docs/PROVIDER-MATRIX.md` — a provider that changes pricing changes what ZERO_COST can use |

## 9. Turning things off

Every merge-added integration is independently switchable, and setting only the required variables
from §2 reproduces the pre-merge behaviour exactly. To disable one, set its `ENABLE_*` to `false`
on **both** Vercel and Render.

To stop all background processing without touching the app: suspend the Render service. Jobs queue
in Redis and resume when it comes back.
