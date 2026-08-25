# AI Production OS — merged architecture

This describes the application **after** the Browser Automation OS merge. `ARCHITECTURE.md` (repo
root) remains the reference for the video-production domain it documents; nothing there was
invalidated, and this document covers what the merge added and changed.

## Shape

One Next.js 15 application, one MongoDB, one Redis, one BullMQ topology, one browser engine, one
worker. Project B's monorepo was dissolved into it — its `packages/*` became directories under
`src/core/`, its worker folded into the root `worker.ts`, its pages became route groups.

```
                          ┌──────────────────────────┐
                          │   Next.js app (Vercel)   │
                          │  UI · API · auth · tick  │
                          └────────────┬─────────────┘
                                       │ enqueue
                          ┌────────────▼─────────────┐
                          │      BullMQ (Redis)      │
                          │  one queue per job type  │
                          └────────────┬─────────────┘
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
   shared processorRegistry   worker-only registry     scheduler sweep
   (Vercel tick + worker)     (worker.ts only)         (worker.ts only)
              │                        │
   story · images · voice     scene_video_auto              │
   render · thumbnail         browser_task                  │
   instagram_reply            automation_workflow           │
   automation_webhook                                       │
   production_plan                                          │
              │                        │                    │
              ▼                        ▼                    ▼
      ┌───────────────┐     ┌────────────────────┐   ┌─────────────┐
      │  AI Gateway   │     │  Browser engine    │   │  Schedules  │
      │ cost · health │     │  Playwright        │   └─────────────┘
      │ fallback      │     │  workflow engine   │
      └───────┬───────┘     └─────────┬──────────┘
              │                       │
   local · OmniRoute · direct   sessions · credentials · recovery
              │                       │
              ▼                       ▼
      ┌──────────────────────────────────────┐
      │        Render: FFmpeg / hybrid       │
      └──────────────────┬───────────────────┘
                         ▼
              Storage: Cloudinary | local disk
                         ▼
                    Final assets
```

## The Vercel / worker split

This is the constraint everything else bends around, and it predates the merge.

`src/core/queue/processors/index.ts` holds processors that are safe in a serverless function.
`src/core/queue/worker-only-processors.ts` holds those that are not — everything that transitively
imports Playwright. Only `worker.ts` registers the second. The Vercel-hosted app cannot reach a
Playwright import from any route, which is what keeps Chromium out of its bundle.

The merge added three processors and respected the split: `automation_workflow` is worker-only;
`automation_webhook` and `production_plan` are HTTP/LLM only and are shared.

The schedule sweeper follows the same rule for a different reason. It lives in `worker.ts` alone
because the serverless tick runs on every enqueue and on cron — a sweeper inside it would fire
schedules repeatedly.

## What each layer owns

**`src/core/ai/`** — capability interfaces (`StoryProvider`, `ImageProvider`, `VideoProvider`,
`VoiceProvider`, `LipSyncProvider`), the registry that knows concrete classes exist, per-provider
cost and health metadata, and the gateway that routes between them. Business logic calls
capabilities and never names a vendor.

**`src/core/cost/`** — the four policies and the gate every provider selection passes through.

**`src/core/browser/`** — the one browser engine. Run lifecycle from this project's framework
(pause/resume/cancel across processes, crash recovery, persisted resume state) grafted onto Project
B's action layer (self-healing selectors, secret interpolation, 23 node types). Persistence is
injected, so the engine itself never touches Mongo.

**`src/core/automation/`** — the workflow interpreter (control flow, per-node retry with
transient/permanent classification, AI decisions, human approval), the schedule sweeper and webhook
delivery.

**`src/core/production/`** — the Director and the pipelines-as-data.

**`src/core/quality/`** — metadata checks, media-level checks, perceptual-hash character
consistency, and per-stage retry targeting.

**`src/core/render/`** — the `RenderProvider` interface. `core/ffmpeg/compose.ts` is untouched and
wrapped, never replaced.

**`src/core/storage/`** — the provider abstraction, Cloudinary and local disk.

**`src/modules/`** — one folder per domain concept: models, zod schema, service. Every collection
is scoped by `userId` and every query filters on it.

## Retry, at three layers

Each layer retries what it is the right layer to retry, and they do not stack by accident:

1. **Node** — the workflow engine retries a failed browser step, classifying transient vs
   permanent. `automation_workflow` therefore gets `attempts: 1` from BullMQ.
2. **Job** — BullMQ retries a whole generation job three times with exponential backoff. Quality
   failures throw into this, which is what makes validation-triggered retry work without a second
   retry system.
3. **Stage** — `core/quality/retry.ts` decides *which* stage a quality failure belongs to, so a
   black clip re-runs video generation rather than the whole production.

## Data

Additive only. No pre-existing collection was renamed, dropped or restructured. The merge added
`Workflow`, `WorkflowVersion`, `Automation`, `AutomationTask`, `Execution`, `ExecutionStep`,
`Schedule`, `Webhook`, `HumanIntervention`, `Credential`, `StoredFile`, `AuditLog` and
`ProductionPlan` — each with a `userId` that Project B's originals did not have.

See [MIGRATION.md](./MIGRATION.md).
