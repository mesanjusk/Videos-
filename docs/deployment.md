# Deployment Guide

Everything here targets free tiers end to end, per the project's cost requirement.

## 1. Provision the free-tier services

| Service | Free tier | Used for |
|---|---|---|
| [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) | M0 cluster | all app data |
| [Cloudinary](https://cloudinary.com) | 25 credits/mo | every image/video/audio asset |
| [Upstash Redis](https://upstash.com) | 10k commands/day | BullMQ |
| [Google Cloud Console](https://console.cloud.google.com) | free | OAuth client for app login |
| [AI Studio](https://aistudio.google.com/app/apikey) | free Gemini quota | per pooled Google account |
| [Vercel](https://vercel.com) | Hobby | hosting |

Create the Atlas cluster and Upstash Redis database first — you'll need their connection strings for
`.env.local`/Vercel env vars below. For Cloudinary, grab the cloud name + API key/secret from the
dashboard's "API Environment variable" panel.

## 2. Google OAuth client (app login)

In Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID (Web application):

- Authorized redirect URI: `https://<your-vercel-domain>/api/auth/callback/google` (and
  `http://localhost:3000/api/auth/callback/google` for local dev).
- Copy the client ID/secret into `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.

This is separate from the Google Account Manager pool (§3 below) — it only governs signing into the
app itself.

## 3. Environment variables

Copy `.env.example` to `.env.local` for local dev, and set the same keys in the Vercel project's
Environment Variables. Generate the two secrets:

```bash
openssl rand -base64 32   # NEXTAUTH_SECRET
openssl rand -hex 32      # ACCOUNTS_ENCRYPTION_KEY (must be exactly 64 hex chars)
```

`GEMINI_API_KEY` is only a local-dev fallback for before you've connected a Google account through
the app's Account Manager UI (`/accounts`) — in production, every generation call uses a pooled
account's own key instead (ARCHITECTURE.md §3).

`CRON_SECRET` — any random string; Vercel automatically sends it as
`Authorization: Bearer $CRON_SECRET` on its own Cron requests when the env var has this exact name.

## 4. Deploy to Vercel

```bash
vercel link
vercel env add ...   # one per variable, or paste them into the dashboard
vercel deploy --prod
```

`vercel.json` declares the `/api/queue/tick` cron as `0 0 * * *` (once daily) — deliberately, because
**Vercel Hobby refuses to deploy a project at all if `vercel.json` schedules a cron more than once a
day**; the original per-minute schedule hard-blocked the first deploy with `Hobby accounts are
limited to daily cron jobs`, no degraded fallback. Read the honesty note in ARCHITECTURE.md §7 before
relying on this: at once a day, the cron is close to useless as a backstop, and the fire-and-forget
self-call after every enqueue (`modules/jobs/service.ts`) is what actually drives near-real-time
processing on Hobby. If you're on Hobby and want a real sub-minute backstop, point a free external
pinger (e.g. [cron-job.org](https://cron-job.org)) at `POST /api/queue/tick` with the `CRON_SECRET`
bearer header instead of relying on `vercel.json`. On Pro, the restriction lifts and `vercel.json` can
go back to a per-minute schedule.

## 5. Long-running work: serverless tick vs. the standalone worker

Every AI/render job runs inside `/api/queue/tick`'s bounded-time worker (§7). This is fine for
story/character/background/scene-image/voice/thumbnail jobs, which finish well inside a function
timeout. **`render` jobs are the exception** — downloading every scene's clip and re-encoding can
outrun a serverless function's time limit on longer videos, especially on Hobby's short timeout. If
that matters for your usage, run `npm run worker` (`worker.ts`) as a small always-on process
somewhere with no per-invocation time limit — Railway, Fly.io, or any VPS — pointed at the same
`MONGODB_URI`/`REDIS_URL`/`CLOUDINARY_*`. It shares the exact same processor code as the serverless
tick; nothing else changes.

## 6. Post-deploy checklist

- [ ] Sign in once, then visit `/accounts` and connect at least one Google account (OAuth-confirm
      identity, then paste a Gemini API key from AI Studio) — nothing generates without one.
- [ ] `/settings` → "System status" should show all three infrastructure rows as "Connected".
- [ ] Create a test project through the wizard and confirm a story generates within ~30s.
- [ ] For the Google Flow video step: it's manual by design (ARCHITECTURE.md §2) — confirm the
      hand-off panel shows a prompt and that uploading a clip back completes the scene.
- [ ] If you plan to render longer videos regularly, stand up `worker.ts` per step 5 rather than
      relying solely on the serverless tick.
