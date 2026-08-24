# MERGE AUDIT — AI Video Studio (Project A) × Browser Automation OS (Project B)

**Phase 1 deliverable. Read-only audit. No code was modified to produce this document.**

Sources actually read:

| | Project A | Project B |
|---|---|---|
| Repo | `mesanjusk/Videos-` (this repo) | `mesanjusk/Automation` |
| Commit audited | `86d0ce2` (branch `claude/merge-video-browser-automation-l89zmt`) | shallow clone of default branch, `/home/user/mesanjusk/automation` |
| package name | `ai-video-studio` | `browser-automation-os` |
| Files | 311 under `src/` + `worker.ts` | 181 tracked files |

Every statement below is derived from reading the source files named in it. Where something could
not be verified from source, it is marked **UNVERIFIED** rather than assumed.

---

## 1. Project A architecture

Single-package Next.js 15 App Router application. No monorepo, no workspaces.

```
src/
  app/
    (auth)/login              — Auth.js sign-in
    (dashboard)/…             — 17 dashboard route groups (projects, characters, scenes,
                                 backgrounds, library, prompts, queue, settings, style-packs,
                                 voice-packs, production, production-profiles, accounts,
                                 browser-automation, instagram)
    api/…                     — ~60 route handlers
  components/                 — ui/ (shadcn-style radix primitives), layout/, shared/, workflow/
  core/                       — framework-free domain engines (see below)
  modules/                    — one folder per domain concept: models/ + schema.ts + service.ts
  hooks/, lib/, types/
  middleware.ts               — Auth.js edge middleware
worker.ts                     — standalone BullMQ worker entrypoint (root, outside src/)
```

`src/core/` subsystems, with real line counts:

| Subsystem | Files | LOC | Purpose |
|---|---|---|---|
| `core/ai/` | 10 | — | provider-agnostic AI contracts + Google provider impls + registry |
| `core/automation/` | 5 | 216 | **Module 4 legacy** Google-Flow-specific Playwright driver |
| `core/browser-automation/` | 13 | 1031 | **Module 7A** generic browser automation framework |
| `core/browser-automation-providers/google-flow/` | 3 | 283 | **Module 7B** the one real ProviderAdapter |
| `core/queue/` | 19 | 1407 | BullMQ queues, orchestrator, 11 processors, two runtimes |
| `core/quality/` | 4 | — | quality checks, dHash, `QualityCheckFailedError` |
| `core/ffmpeg/` | 1 | ~300 | full compose filter-graph (xfade, zoompan, acrossfade, subtitles) |
| `core/production-engine/` | 4 | — | Module 6 "topic → Generate" entry point |
| `core/prompt-engine/` | 12 | — | templated prompt rendering, 9 scopes |
| `core/storage/` | 1 | — | Cloudinary upload helpers |
| `core/auth/` | 4 | — | Auth.js config + AES-256-GCM secret encryption |
| `core/db/` | 3 | — | Mongoose + native driver connection caches |
| `core/instagram/` | 1 | — | Meta Graph API client |

`src/modules/` (18 modules): accounts, api-tokens, assets, backgrounds, browser-automation,
characters, instagram, jobs, production-profiles, production-runs, projects, prompt-templates,
scenes, settings, style-packs, voice-packs.

**Architectural convention observed in the source:** `core/` never imports `modules/` models
directly for framework pieces — persistence is injected (`SessionStore`, `StateStore`, `TaskStore`
interfaces in `core/browser-automation/`, implemented in `modules/browser-automation/service.ts`).
This is real Clean-Architecture DI, not a comment claiming it.

## 2. Project B architecture

npm-workspaces monorepo.

```
apps/
  web/          Next.js 14 dashboard (App Router), 14 dashboard pages, 11 API routes
  worker/       Express health server + BullMQ workers + DB-polling scheduler
  test-site/    a local target site for e2e demo automation
packages/
  shared/           enums, zod schemas, AutomationError  (the single source of truth for strings)
  database/         mongoose connection + 15 models + seed
  security/         AES-256-GCM encryption, API keys, bcrypt passwords, rate limit
  queue/            ioredis connection + 5 BullMQ queues
  browser/          Playwright session, self-healing selector resolver, 23 actions, page snapshot
  automation-engine/ workflow interpreter (control flow, retry, conditions, AI decisions)
  storage/          StorageProvider abstraction: local disk + Cloudinary
  ai/               LLMProvider abstraction + Gemini impl + agent safety
```

Dependency direction: `apps/*` → `packages/*`; `automation-engine` → `browser` + `shared`;
`browser` → `shared`. No package imports an app. This is a clean layering.

## 3. package.json dependencies

**Shared between both (identical role, different versions):** `next`, `react`, `react-dom`,
`next-auth`, `mongoose`, `bullmq`, `ioredis`, `playwright`, `cloudinary`, `zod`, `clsx`,
`tailwind-merge`, `lucide-react`, `next-themes`, `tailwindcss`, `typescript`.

**A only:** `@google/genai`, `ffmpeg-static`, `fluent-ffmpeg`, `sharp`, `framer-motion`,
`@auth/mongodb-adapter`, `mongodb`, `react-hook-form`, `@hookform/resolvers`,
`class-variance-authority`, 11 `@radix-ui/*` packages, `tailwindcss-animate`.

**B only:** `reactflow` (workflow builder canvas), `date-fns`, `express`, `cron-parser`,
`bcryptjs`, `vitest`.

**Version conflicts that matter for a merge:**

| Package | A | B | Resolution |
|---|---|---|---|
| next | ^15.1.3 | ^14.2.15 | **A wins** — B's pages must be ported to 15 (async `params`/`searchParams`) |
| react / react-dom | ^19.0.0 | ^18.3.1 | **A wins** — `reactflow@11` support on React 19 is **UNVERIFIED**; see §29 risk |
| next-auth | ^5.0.0-beta.25 | ^4.24.8 | **A wins** — v4 and v5 have incompatible APIs; B's `apps/web/lib/auth.ts` must be dropped |
| bullmq | ^5.34.6 | ^5.21.2 | A (newer, same major) |
| playwright | ^1.62.1 | ^1.48.2 | A (newer) |
| zod | ^3.24.1 | ^3.23.8 | A (newer, same major) |
| eslint | ^9.17.0 | ^8.57.1 | A (newer major) |

New dependencies the merge must add to A: `vitest`, `cron-parser`, `bcryptjs` (only if B's
password auth is kept — see §11), `reactflow` (only if the visual workflow builder is kept),
`date-fns`. `express` is **not** needed — A's worker has no health server today, and one can be
added with `node:http` rather than pulling in Express.

## 4. Next.js versions

A: `^15.1.3`, App Router, `serverExternalPackages: ["fluent-ffmpeg","ffmpeg-static","sharp"]`,
`images.remotePatterns` for Cloudinary + Google avatars. Uses `after()` from `next/server` in
`modules/jobs/service.ts` — a Next 15 API.

B: `^14.2.15`, App Router. Uses Server Actions extensively (`apps/web/lib/actions/*.ts`, 9 files).

**Consequence:** B's route handlers use the Next 14 signature `{ params: { id: string } }`.
Next 15 made `params` a Promise. Every ported B route/page needs `await params`.

## 5. React versions

A: 19. B: 18. Merging on 19 is required (A is primary). The concrete risk is `reactflow@11.11.4`
in B's `workflow-builder.tsx`; its React 19 peer support is **UNVERIFIED** and must be tested
before the visual builder is ported. A JSON/form-based workflow editor is the fallback.

## 6. MongoDB architecture

**A** — `core/db/mongoose.ts` caches the connection on `globalThis._mongooseCache`, with explicit
handling for `mongoose.connect()` throwing synchronously on a malformed URI and for not caching a
permanent failure. `core/db/mongo-client.ts` is a *second, separate* native-driver client, used by
`@auth/mongodb-adapter`. `core/db/register-models.ts` is an import-for-side-effects barrel that
guarantees model registration before `populate()` — it currently registers **9** of A's 20+ models.

A's collections (from `src/modules/*/models/`): `GoogleAccount`, `ApiToken`, `Asset`, `Background`,
`BrowserExecutionLog`, `BrowserProviderConfig`, `BrowserSession`, `BrowserTaskRun`, `Character`,
`InstagramAccount`, `InstagramMessage`, `Job`, `ProductionProfile`, `ProductionRun`, `Project`,
`PromptTemplate`, `Scene`, `Settings`, `StylePack`, `VoicePack`.

Every A model is scoped by a `userId: String` field (Auth.js user id), indexed. **A is
multi-tenant by convention on every query.**

**B** — `packages/database/src/connection.ts` + 15 models: `AIRequest`, `ApiKey`, `AuditLog`,
`Automation`, `BrowserProfile`, `Credential`, `Execution` (+ `ExecutionStep`), `File`,
`HumanIntervention`, `Schedule`, `Task`, `User`, `Webhook`, `Workflow` (+ `WorkflowVersion`).

B models use `createdBy: ObjectId → User` and are **not** consistently tenant-filtered — B is
effectively single-tenant/admin. **This is a security-relevant impedance mismatch** (see §23).

## 7. Redis architecture

Both use `ioredis` with `maxRetriesPerRequest: null` (BullMQ's requirement), both cache a single
shared connection. A additionally sets `enableReadyCheck: false` (needed for Upstash) and caches on
`globalThis` (needed for serverless warm reuse); B caches in module scope and exposes
`closeRedisConnection()`.

**Duplicate.** A's `core/queue/connection.ts` is the more deployment-hardened of the two; B's
`closeRedisConnection()` is a genuinely useful addition A lacks (needed for clean worker shutdown
and for tests).

## 8. BullMQ architecture

**A** — one BullMQ queue **per job type**, named after the job type, lazily created and cached
(`core/queue/queues.ts`). 11 job types in `JOB_TYPES`. Default job options: 3 attempts, exponential
backoff 5 s, `removeOnComplete` 7 d, `removeOnFail` 30 d.

**B** — 5 fixed queues by function (`QUEUE_NAMES`): `automation-tasks`, `browser-sessions`,
`screenshots`, `webhooks`, `cleanup`. `enqueueAutomationTask` deliberately sets **`attempts: 1`** —
"retries are handled inside the workflow engine per-node, not by BullMQ". Webhooks get 5 attempts
with exponential backoff.

**These are two genuinely different and both-defensible strategies.** A's queue-per-type lets the
serverless tick route enumerate exactly the types it may run; B's per-node retry gives far better
retry semantics for long browser runs (retrying one failed click, not the whole 40-step task).

**Merge implication:** keep A's queue-per-job-type topology (it is load-bearing for A's
Vercel/worker split), and adopt B's `attempts: 1` **for browser/workflow job types specifically**,
since the workflow engine retries internally. Mixing them per-type is coherent; a single global
policy is not.

## 9. Worker architecture

**A has two runtimes for the same processors** — a deliberate, documented design:

1. `worker.ts` (root) — persistent BullMQ `Worker` per job type, concurrency 2, registers
   `processorRegistry` **and** `workerOnlyProcessorRegistry`, plus `registerGoogleFlowProvider()`.
2. `core/queue/worker-runtime.ts#runQueueTick()` — the Vercel-serverless adaptation: creates
   Workers with `autorun: false`, runs them for `QUEUE_TICK_BUDGET_MS` (45 s default), closes them.
   Registers **only** `processorRegistry`. Invoked by `POST /api/queue/tick` (Vercel Cron, daily on
   Hobby) *and* in-process via `after()` from `enqueueJob`.

The split between the two registries is the mechanism that keeps Playwright out of the Vercel
bundle. `worker-only-processors.ts` holds exactly `scene_video_auto` and `browser_task`.

**B** — one always-on process (`apps/worker/src/index.ts`): a task worker
(concurrency `BROWSER_MAX_CONCURRENCY`, default 3), a webhook worker (concurrency 5), an HTTP
health server bound to `PORT`/`WORKER_PORT`, and a `setInterval` scheduler. Clean SIGTERM/SIGINT
shutdown. No serverless variant — B assumes a persistent host (Render).

**Merge implication:** A's dual-runtime split must be preserved exactly — it is what makes the
Vercel deployment legal. B's contributions to fold in: the health endpoint, the scheduler loop, and
graceful shutdown of Redis.

## 10. Playwright architecture

**Three separate Playwright implementations exist across the two projects.**

| # | Location | Nature | Maturity |
|---|---|---|---|
| 1 | A `core/automation/` (Module 4) | Google-Flow-specific driver, hardcoded `FLOW_SELECTORS`, circuit breaker on verification-challenge / logged-out | 216 LOC, selectors self-documented as *unverified against the live product* |
| 2 | A `core/browser-automation/` (Module 7A) | Generic framework: BrowserManager, TabManager, SessionManager, ActionEngine (18 action types), ActionPipeline, StateEngine, RecoveryEngine, ExecutionMonitor, ProviderAdapter registry, TaskEngine with `execute`/`resume`/`pause`/`cancel` | 1031 LOC, DI throughout, Mongo-backed stores, cross-process cooperative cancel via DB flag polling |
| 3 | B `packages/browser/` | `BrowserSession` (shared browser, per-profile context, tab tracking), **self-healing `resolveTarget`** (7 strategies: testId → css → role → text → aria-label → nearby-text → xpath → AI-visual), 23 action node types, `{{var}}` + `{{secret:name}}` interpolation, `buildPageSnapshot` for the AI agent | tested (`selectorResolver.test.ts`) |

**Capability comparison — neither is a superset of the other:**

| Capability | A 7A | B browser |
|---|---|---|
| Run lifecycle: pause / resume / cancel across processes | ✅ (Mongo flag polling) | ❌ (`shouldCancel` hook only, in-process) |
| Persisted resumable run state (`StateEngine` + `BrowserTaskRun.currentStepIndex`) | ✅ | partial (`Task.currentStepId`) |
| Browser crash recovery / restart with state resume | ✅ `RecoveryEngine` | ❌ |
| Self-healing selector fallback chain | ❌ (raw CSS strings) | ✅ |
| Secret injection that never reaches logs/variables | ❌ | ✅ `interpolateWithSecrets` |
| Control flow (condition / loop / for-each / variables) | ❌ | ✅ `automation-engine` |
| AI agent decision loop with domain allowlist + action cap | ❌ | ✅ `packages/ai/safety.ts` |
| Human approval pause | ❌ | ✅ `HUMAN_APPROVAL` node |
| Tab management | ✅ `TabManager` | ✅ `BrowserSession.tabs` |
| Per-node retry policy with transient/permanent classification | ❌ (BullMQ-level only) | ✅ `withRetry` + `FailureCategory` |
| Screenshots persisted as files | placeholder paths until 7B | ✅ via `File` model + storage provider |

**This is the single most important finding of the audit.** The correct merge is *not* "pick one".
It is: keep A's TaskEngine lifecycle/recovery shell, and replace its naive action + selector layer
with B's resolver, interpolation, and node vocabulary; then put B's `automation-engine` on top as
the workflow interpreter. Retiring #1 (Module 4) entirely is safe **only** because #3 (7B's
`google-flow/adapter.ts`) already reimplements the same Flow flow against the generic framework —
see §28.

## 11. Authentication

**A** — Auth.js (next-auth v5 beta) with Google OAuth, `@auth/mongodb-adapter` persisting to the
same MongoDB. `middleware.ts` builds a *separate* edge-safe `NextAuth(authConfig)` because the full
config pulls in the MongoDB native driver, which the Edge runtime cannot run. Route matcher covers
`/dashboard`, `/projects`, `/accounts`, `/prompts`, `/settings`.

Separately, A has **API tokens** (`modules/api-tokens/`) for the Claude Code plugin, and a
**Google Account Manager** (`modules/accounts/`) — a *pool* of generation accounts with
AES-256-GCM-encrypted OAuth tokens, quota tracking, and `reactivateExpiredQuotas()`. This is
distinct from app login and has no equivalent in B.

**B** — next-auth v4 with a Credentials provider over `User` + bcrypt (`packages/security/passwords.ts`),
plus `ApiKey` (sha256-hashed, `bos_live_` prefix) for the public API, plus in-memory rate limiting.

**Merge decision:** A's Auth.js v5 + Google OAuth is the app login — keep unchanged. B's v4 setup,
`User` model, and bcrypt passwords are **dropped** (A already has session auth; adding a second
login path is a security regression, not a feature). B's **`ApiKey` model is redundant** with A's
`ApiToken` — dedupe to A's. B's `checkRateLimit` and `AuditLog` are **kept** — A has neither.

**Two `middleware.ts` files exist** (A's and B's). Only A's survives; its matcher must be extended
to the new routes.

## 12. Storage

**A** — Cloudinary only, `core/storage/cloudinary.ts`: `uploadImageAsset`, `uploadVideoAsset`,
`uploadAudioAsset` (audio uploaded as `resource_type: "video"` — Cloudinary has no audio type),
`getSignedUploadParams` for browser-side widget uploads. Throws if Cloudinary env vars are absent.
**There is no local-filesystem path.** Cloudinary is currently mandatory for any generation.

**B** — a real `StorageProvider` interface with two implementations (`LocalStorageProvider`,
`CloudinaryStorageProvider`) selected by `STORAGE_PROVIDER`, plus `/api/files/local/[...key]` to
serve local files.

**B's abstraction is strictly better and is the one to adopt.** It is also a hard prerequisite for
ZERO_COST mode (§22, §9 of the master task): Cloudinary's free tier is finite, so a zero-cost run
must be able to write to disk. A's Cloudinary functions become the body of the Cloudinary provider;
A's `getSignedUploadParams` has no B equivalent and must be preserved as a Cloudinary-specific
extension.

## 13. Cloudinary

Both configure the SDK the same way (`cloud_name`/`api_key`/`api_secret`, `secure: true`) and both
upload via `upload_stream`. Differences: A pins `resource_type` explicitly per asset kind and sets
`overwrite: true`; B uses `resource_type: "auto"` and namespaces everything under a
`browser-automation-os/` folder prefix. A returns `width`/`height`/`duration` (the quality checks in
`core/quality/checks.ts` consume Cloudinary's *measured* dimensions — deliberately, so the check
isn't validating a provider's self-report against itself). B returns only `size`.

**Merge:** one `CloudinaryStorageProvider` implementing B's interface, with A's per-kind
`resource_type` and its width/height/duration passthrough retained — dropping those would silently
break `checkImageResolution`.

## 14. AI providers

**A** — `core/ai/types.ts` is a genuine capability-per-interface abstraction: `StoryProvider`,
`ImageProvider`, `VideoProvider`, `VoiceProvider`, `LipSyncProvider`, each with `id`/`label` and a
`GenerationAccountContext` parameter so a pooled account can be threaded through. `registry.ts` is
documented as "the one and only place that knows concrete provider classes exist".

Registered and enabled: `gemini` (story, image, voice), `google-flow` (video),
`manual` (lipsync). Declared-but-disabled in `FUTURE_PROVIDERS`: openai, claude, flux, runway,
kling, veo-vertex, local, hedra, heygen.

Notable: `VideoGenerationResult` and `LipSyncGenerationResult` are discriminated unions with a
`manual_pending` variant — the abstraction already models "no API exists, a human must do this",
which is exactly the shape a browser-automation fallback needs.

**B** — `packages/ai/src/provider.ts` defines one `LLMProvider` with three methods
(`decideNextAction`, `locateElementInScreenshot`, `generateWorkflowDraft`). Gemini is the only
implementation. `safety.ts` enforces a max-action cap and a domain allowlist **before** an
AI-chosen action reaches the browser.

**Assessment against the master task's Rule 6/7:** A's abstraction already satisfies "never
hardcode a provider" for the five video-production capabilities. What neither project has:
capability/cost/health metadata on a provider, fallback chains, or any notion of a paid vs free
route. Those are additive, not a rewrite.

**Missing entirely from both:** an `AiGateway` routing layer, OmniRoute, cost policy, quota
tracking. `ProviderQuotaExceededError` exists in A's types as the hook to build on.

## 15. Video generation

A only. Two paths, both behind `VideoProvider`:

- `google-flow-video.ts` — returns `status: "manual_pending"` with a prompt for a human to run.
- `google-flow-automated.ts` — the `scene_video_auto` job type, drives Flow via Playwright
  (Module 4's driver), and **falls back to the manual hand-off on `AutomationCircuitBreakerError`**.

This fallback is already the pattern §16 of the master task asks for; it is currently wired to
Module 4's driver rather than the generic framework.

B has no video generation.

## 16. Image generation

A only. `gemini-image.ts` implements all four `ImageProvider` methods (character sheet across 10
poses, background, scene image, thumbnail), each rendered through `core/prompt-engine/`. Output
dimensions are self-reported as 1080×1350 regardless of what Gemini returns — which is precisely
why `checkImageResolution` validates Cloudinary's measurement instead.

No local/Stable-Diffusion path exists. `FUTURE_PROVIDERS` has a `local` image entry, disabled.

## 17. Voice generation

A only. `gemini-voice.ts` implements `VoiceProvider.generateVoice` via `GEMINI_TTS_MODEL`.
`modules/voice-packs/` stores reusable voice configurations. No local TTS, no Voicebox.

## 18. FFmpeg

A only, `core/ffmpeg/compose.ts` (~300 LOC), invoked exclusively from `render.processor.ts` — never
from a route. Pinned to `ffmpeg-static` deliberately (the comment records that
`@ffmpeg-installer/ffmpeg` ships a 2018 build without the `xfade` filter).

The filter graph does: per-clip scale/crop to 1080×1920 + `fps=30` + Ken Burns `zoompan`; pairwise
`xfade` chain; per-scene narration with `anullsrc` silence padding so audio stays in sync with the
video crossfades; `acrossfade` chain; music bed at `volume=0.2` mixed with `amix`; burned subtitles
via `libass` (the build has no `drawtext`); optional watermark overlay. Duration is probed by
parsing `ffmpeg -i` stderr, because `ffmpeg-static` ships no `ffprobe`.

**This is the single most fragile and most valuable file in either codebase.** Rule 12 (do not
replace FFmpeg) is well-founded: this graph is hand-tuned and the comment records it was verified
against synthetic clips. HyperFrames must be added *beside* it.

## 19. Browser automation

Covered in §10. Summary of what exists:

- A Module 4 (`core/automation/`): Flow-specific, legacy, superseded.
- A Module 7A (`core/browser-automation/`) + 7B (`core/browser-automation-providers/google-flow/`):
  generic framework + one adapter; `browser_task` job type; Mongo persistence
  (`BrowserTaskRun`, `BrowserSession`, `BrowserExecutionLog`, `BrowserProviderConfig`); REST API
  under `/api/browser-automation/…` with pause/resume/cancel/restart; a dashboard page.
- B: `packages/browser` + `packages/automation-engine` + `apps/worker/src/processor.ts`; workflow
  versioning; schedules; webhooks; human approval; credentials; profiles; files; audit log; a
  visual builder; a public `/api/v1/…` API keyed by `ApiKey`.

## 20. MCP

**Project A only, and it is not part of the app.** `plugin/` is a Claude Code plugin
(`plugin/.claude-plugin/`, `plugin/mcp-server/`, `plugin/skills/`) that drives the app's REST API
using the `ApiToken` from `modules/api-tokens/`. It is a client of the app, not a component of it.

**It must not be broken by the merge**, and it is the reason `modules/api-tokens/` cannot be
deleted in favour of B's `ApiKey`. Project B has no MCP.

## 21. Quality verification

A only, and smaller than the master task's §17 list implies. What actually exists:

- `checkImageResolution` — tolerance-based, against Cloudinary's measurement, **`error` severity**.
- `checkVideoDuration` — 5–8 s window, **`warning` severity**.
- `checkSceneCompleteness` — status-vs-assets integrity, **`warning`**.
- `computeDHash` / `dHashSimilarity` — 64-bit difference hash for character consistency,
  **`warning` only**, and honestly documented as a structural heuristic, not perceptual ML.
- `QualityCheckFailedError` — thrown only for `error`-severity issues on AI-synchronous paths,
  never for human uploads.

**Not implemented, contrary to what a reader of the master task might assume:** frame rate, codec,
file integrity, audio presence/duration, black-frame detection, duplicate-frame detection, caption
presence, scene ordering. These are additions, not preservations.

`core/production-engine/resolve-quality-targets.ts` resolves per-profile thresholds from
`ProductionProfile.quality`.

## 22. Auto retry

A's retry is **BullMQ-native, not a bespoke system**: `QualityCheckFailedError` propagates through
`processors/helpers.ts#withJobLifecycle` like any other error, so BullMQ's `attempts: 3` +
exponential backoff applies. `Job.status` moves to `retrying`. The design note in `quality/errors.ts`
is explicit that this is "validation-triggered retry", reusing the existing mechanism rather than
adding a second one.

B's retry is **per-node inside the workflow engine** (`withRetry` + `RetryPolicy` on each node),
with `FailureCategory` deciding retryability — `TRANSIENT` retries, `PERMANENT`/`AUTHENTICATION`/
`HUMAN_INTERVENTION_REQUIRED` fail fast.

**Both are worth keeping, at different layers.** B's is finer-grained and is what a 40-step browser
task needs; A's is what a single-shot image generation needs. They do not conflict — B's operates
inside one BullMQ job.

Rule 13's "do not replace the existing Quality Verification + Auto Retry system" is satisfied by
keeping A's exactly as-is and adding B's classification to the browser layer, plus per-stage retry
targeting (retry only the failed stage) as new work.

## 23. Scheduling

**B only.** `Schedule` model (ONCE/HOURLY/DAILY/WEEKLY/CRON + timezone + `nextRunAt`) and
`apps/worker/src/scheduler.ts` — a 60-second `setInterval` polling MongoDB. Deliberately DB-polling
rather than a cron daemon so the platform needs only MongoDB + Redis.

**A has only** the Vercel Cron entry in `vercel.json` (`/api/queue/tick`, `0 0 * * *` — daily,
because Vercel Hobby allows no more).

B's scheduler transplants cleanly into A's `worker.ts`. Note it must **not** run in the serverless
tick (it would fire on every warm invocation).

## 24. Webhooks

**Inbound, A:** `/api/webhooks/instagram` (Meta verification + message events),
`/api/instagram/callback` (OAuth).

**Outbound, B:** `Webhook` model (url, events, secret, enabled, last delivery status), a dedicated
BullMQ `webhooks` queue with 5 attempts / exponential backoff, `apps/worker/src/webhookDelivery.ts`
(**has a test**), and a `WEBHOOK` workflow node type.

No overlap. Both are kept.

## 25. Security

**A:** AES-256-GCM (`core/auth/encryption.ts`, `iv:authTag:ciphertext` colon-joined base64) keyed by
`ACCOUNTS_ENCRYPTION_KEY`; Auth.js sessions; every service function takes `userId` and every query
filters on it; `core/queue/worker-only-processors.ts` keeps Playwright out of the serverless bundle;
`CRON_SECRET` bearer check on the tick route.

**B:** AES-256-GCM (`packages/security/encryption.ts`, `iv+authTag+ciphertext` concatenated base64)
keyed by `ENCRYPTION_KEY`; `redactSecrets()`; sha256 API keys; bcrypt(12) passwords; in-memory rate
limiting; `AuditLog` model; `select: false` on every secret-bearing field (`encryptedStorageState`,
`encryptedValue`, `Webhook.secret`) so they cannot leak through a careless `.lean()`;
`enforceAgentSafety` domain allowlist + action cap; `interpolateWithSecrets` keeps credentials out
of the variable bag, logs, and AI prompts; `buildPageSnapshot` deliberately excludes raw HTML to
avoid leaking password field values.

**Two incompatible encryption formats and two key env vars.** They are not interchangeable:
A joins with `:` and base64-encodes each part; B concatenates raw bytes and base64s the whole.
Existing ciphertext in either database cannot be read by the other implementation. **A migration or
a dual-read shim is mandatory** — see §31.

**Security gaps found in the audit (both projects):**
- B's models are not tenant-scoped; grafting them onto A's multi-tenant app without adding `userId`
  would let any user read any other user's credentials, profiles, and tasks. **This is the single
  highest-severity merge risk.**
- B's `EXECUTE_JS` node runs `new Function(...)` on author-supplied script — acceptable for a
  single-admin tool, a privilege-escalation vector in a multi-tenant one.
- Neither project validates or allowlists navigation URLs outside B's AI path (`NAVIGATE` nodes
  accept any URL) — SSRF-adjacent, and the master task's §23 calls it out.
- A's `PlaywrightActionEngine` writes downloads/screenshots to a fixed `/tmp/browser-automation`
  with the provider-supplied `download.suggestedFilename()` — **path traversal is possible** if a
  hostile site suggests `../../…`. B's local provider sanitizes (`sanitize()`); A's does not.

## 26. Environment variables

**A (21, all verified by grep over `src/` + `worker.ts`):** `NEXTAUTH_URL`, `NEXTAUTH_SECRET`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ACCOUNTS_ENCRYPTION_KEY`, `MONGODB_URI`,
`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `REDIS_URL`,
`QUEUE_TICK_BUDGET_MS`, `CRON_SECRET`, `AI_STORY_PROVIDER`, `AI_IMAGE_PROVIDER`,
`AI_VIDEO_PROVIDER`, `AI_VOICE_PROVIDER`, `AI_LIPSYNC_PROVIDER`, `GEMINI_API_KEY`,
`GEMINI_TEXT_MODEL`, `GEMINI_IMAGE_MODEL`, `GEMINI_TTS_MODEL`, plus
`INSTAGRAM_*` (5) and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`.

**B (~25):** `MONGODB_URI`, `REDIS_URL`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_VISION_MODEL`,
`MAX_AI_ACTIONS`, `AI_ALLOWED_DOMAINS`, `STORAGE_PROVIDER`, `CLOUDINARY_*` (3),
`LOCAL_STORAGE_DIR`, `ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `API_BASE_URL`,
`WORKER_PORT`, `WORKER_ID`, `WORKER_HEALTH_URL`, `WORKER_CALLBACK_URL`, `BOOTSTRAP_API_KEY`,
`DEFAULT_CRM_WEBHOOK_URL`, `PLAYWRIGHT_HEADLESS`, `BROWSER_MAX_CONCURRENCY`, `TEST_SITE_*`.

**Collisions:** `MONGODB_URI`, `REDIS_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `CLOUDINARY_*`,
`GEMINI_API_KEY` — same meaning in both, no conflict.
**Semantic conflict:** `ACCOUNTS_ENCRYPTION_KEY` (A) vs `ENCRYPTION_KEY` (B) — same algorithm,
different key var, incompatible ciphertext format.
**Conflict:** `GEMINI_MODEL` (B, one model) vs `GEMINI_TEXT_MODEL`/`GEMINI_IMAGE_MODEL`/
`GEMINI_TTS_MODEL` (A, three). A's is the more precise scheme.

Neither `.env.example` mentions any cost policy, OmniRoute, Voicebox, Ideogram, or HyperFrames
variable — all of those are new.

## 27. Deployment architecture

**A:** Next.js app on Vercel (`vercel.json` declares the daily cron). Queue drains either via the
serverless tick or via `worker.ts` on any always-on host. Playwright is excluded from the Vercel
bundle by the two-registry split; `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is set on Vercel only. No
Docker, no compose file, no CI workflow.

**B:** `render.yaml` blueprint (worker + optional web, both Docker, both `plan: free`),
per-app Dockerfiles built from the repo root (the file documents *why*: Render's Node buildpack
does not resolve workspace siblings), `docker-compose.yml` with mongo/redis/web/worker/test-site,
and `.github/workflows/keep-worker-warm.yml` pinging `/health` every 10 min to stop Render's free
tier spinning down. `scripts/preflight.mjs` fails the build fast on a stale tree.

**Merge:** A's Vercel deployment is preserved unchanged (Rule 15). B's Render worker blueprint,
docker-compose, and the keep-warm workflow are adapted to the merged single-package layout — the
monorepo-specific Dockerfile reasoning no longer applies once there are no workspaces, which
*simplifies* them.

## 28. Duplicate modules

Ordered by how much work deduplication costs.

| # | Concern | A | B | Verdict |
|---|---|---|---|---|
| 1 | Redis connection | `core/queue/connection.ts` | `packages/queue/src/connection.ts` | **A wins**; port B's `closeRedisConnection()` |
| 2 | Mongo connection | `core/db/mongoose.ts` | `packages/database/src/connection.ts` | **A wins** (globalThis cache, sync-throw handling) |
| 3 | BullMQ queue factory | `core/queue/queues.ts` | `packages/queue/src/queues.ts` | **A's topology wins**; add B's queue names as new job types |
| 4 | Cloudinary upload | `core/storage/cloudinary.ts` | `packages/storage/src/cloudinaryProvider.ts` | **B's interface wins, A's body wins** — merge into one provider |
| 5 | AES-256-GCM encryption | `core/auth/encryption.ts` | `packages/security/src/encryption.ts` | **One implementation**, dual-read for migration (§31) |
| 6 | Playwright browser launch | 7A `browser-manager.ts` **and** Module 4 `browser-session.ts` | `packages/browser/src/session.ts` | **Three** → one |
| 7 | Playwright action execution | 7A `action-engine.ts` (18 actions) | `packages/browser/src/actions.ts` (23 node types) | Merge; B's vocabulary + A's engine interface |
| 8 | Session/storageState persistence | `BrowserSession` model + `MongoSessionStore` | `BrowserProfile.encryptedStorageState` | **Merge into one**; B's model has richer profile fields (userAgent/viewport/locale/timezone/status), A's has provider scoping + userId |
| 9 | Browser task/run record | `BrowserTaskRun` | `Task` + `Execution` + `ExecutionStep` | B's is a normalized 3-collection model with per-step rows; A's is one doc. **B's step-level detail wins** for observability; A's `taskDefinition`/resume fields must be carried over |
| 10 | Execution logging | `BrowserExecutionLog` | `ExecutionStep` + `AuditLog` | Fold A's into B's step rows |
| 11 | API credentials | `modules/api-tokens/ApiToken` | `packages/database/ApiKey` | **A wins** — the MCP plugin depends on it (§20) |
| 12 | Provider config | `BrowserProviderConfig` | `Automation` | Different concepts, both kept |
| 13 | Auth | Auth.js v5 + Google | next-auth v4 + credentials | **A wins**, B's dropped |
| 14 | Worker entrypoint | `worker.ts` | `apps/worker/src/index.ts` | **A wins**, absorb B's health server + scheduler + shutdown |
| 15 | UI shell (sidebar/topbar/theme) | `components/layout/*` | `apps/web/components/*` | **A wins** (radix + framer-motion, richer) |
| 16 | Retry | BullMQ attempts | `withRetry` per node | Both, at different layers (§22) |
| 17 | `.env.example` | root | root | One merged, grouped file |
| 18 | `middleware.ts` | `src/middleware.ts` | `apps/web/middleware.ts` | **A wins**, matcher extended |

## 29. Conflicting implementations

Things that cannot simply coexist and require a decision:

1. **Next 15/React 19 vs Next 14/React 18.** Every B page and route needs porting. `reactflow@11`
   on React 19 is **UNVERIFIED** — if it breaks, the visual workflow builder ships as a
   form/JSON editor and the canvas is deferred. This is the largest single unknown in the merge.
2. **next-auth v5 beta vs v4.** Incompatible APIs; B's auth is dropped wholesale.
3. **Encryption ciphertext format.** Not interchangeable. Any existing encrypted rows in either
   database become unreadable if the wrong implementation is used. Requires a dual-read shim.
4. **Tenancy model.** A: `userId` string on every document, filtered in every service call.
   B: `createdBy` ObjectId, not filtered. Porting B's models **must** add `userId` + query filters,
   or the merge introduces a cross-tenant data leak.
5. **BullMQ retry philosophy.** 3 attempts globally (A) vs 1 attempt + engine-internal retry (B).
   Resolved per-job-type, not globally.
6. **Queue topology.** Per-job-type (A) vs per-function (B). A's wins because the Vercel/worker
   registry split depends on being able to enumerate permitted types.
7. **Two browser frameworks in A alone** (Module 4 and Module 7A/7B). Module 4 is already
   superseded in fact — `google-flow/adapter.ts` reimplements the same flow on the generic
   framework — but both are still wired: `scene_video_auto` uses Module 4, `browser_task` uses 7A.
   Only after `scene_video_auto` is re-pointed at the framework can `core/automation/` be deleted.
8. **`GEMINI_MODEL` vs `GEMINI_*_MODEL`.** A's three-variable scheme wins.
9. **Storage default.** A: Cloudinary mandatory. B: local default. Merged default must be
   `STORAGE_PROVIDER=cloudinary` to preserve current production behaviour (Rule 15), with `local`
   available and required for ZERO_COST.

## 30. Reusable modules

Portable to the merged app with little or no change:

**From B —**
- `packages/security/*` — encryption, `redactSecrets`, API keys, rate limit. Tested.
- `packages/storage/*` — the whole StorageProvider abstraction. Tested by inspection, no unit tests.
- `packages/shared/enums.ts` + `errors.ts` — `AutomationError`, `FailureCategory`, `isTransient`,
  `NODE_TYPES`, `SELECTOR_STRATEGIES`. Zero dependencies, drops in as-is.
- `packages/browser/selectorResolver.ts` — self-healing resolution. **Has tests.**
- `packages/browser/interpolate.ts` — `{{var}}` and `{{secret:}}`. Security-relevant.
- `packages/browser/actions.ts` — 23 action implementations.
- `packages/browser/pageSnapshot.ts` — AI-agent context builder.
- `packages/automation-engine/*` — engine, retry, condition, AI adapter. **Has tests.**
- `packages/ai/safety.ts` — `enforceAgentSafety`.
- `apps/worker/src/scheduler.ts`, `webhookDelivery.ts` (**tested**), `health.ts`.
- `docker-compose.yml`, `render.yaml`, `.github/workflows/keep-worker-warm.yml`,
  `scripts/preflight.mjs`, `vitest.config.ts`.
- Models: `BrowserProfile`, `Credential`, `Schedule`, `Webhook`, `HumanIntervention`, `File`,
  `AuditLog`, `Workflow`/`WorkflowVersion`, `Execution`/`ExecutionStep`, `Automation` — **each
  requiring a `userId` field added**.

**From A — everything is already in place**; the reusable-in-new-contexts pieces are
`core/ai/types.ts` (the provider contracts the new gateway will extend), `core/prompt-engine/`,
`core/quality/`, `core/ffmpeg/compose.ts`, and `modules/production-profiles/`.

## 31. Modules that must NOT be deleted

Deleting or "replacing with the equivalent from the other project" any of these breaks working,
shipped functionality. This list is the concrete form of Golden Rules 1–4 and 12–15.

**Project A — absolutely preserve:**

1. `src/core/ffmpeg/compose.ts` — hand-tuned filter graph (Rule 12).
2. `src/core/quality/*` — all four files (Rule 13).
3. `src/core/queue/worker-only-processors.ts` + the two-registry split — **deleting this puts
   Playwright in the Vercel bundle and breaks the deployment** (Rule 15).
4. `src/core/queue/worker-runtime.ts` — the serverless tick; Vercel has no other way to drain.
5. `src/core/ai/types.ts` + `registry.ts` — the provider abstraction everything routes through.
6. `src/core/prompt-engine/*` — 9 template scopes, user-editable via the Prompt Library.
7. `src/modules/characters/*` + `core/quality/perceptual-hash.ts` — character consistency (Rule 32).
8. `src/modules/accounts/*` — the pooled Google generation accounts with quota tracking. No B
   equivalent; unrelated to app login.
9. `src/modules/api-tokens/*` — the MCP plugin authenticates with these (§20).
10. `src/modules/production-profiles/*` + `production-runs/` + `core/production-engine/` — Module 6.
11. `src/core/queue/orchestrator.ts` — the full-automation auto-chain.
12. `src/core/storage/cloudinary.ts#getSignedUploadParams` — no B equivalent; the manual
    video/lipsync hand-off upload widget depends on it.
13. `src/core/auth/*` + `src/middleware.ts` — app login.
14. `src/core/instagram/*` + `modules/instagram/*` + the webhook route.
15. `plugin/` — the Claude Code plugin, entirely.
16. `src/core/browser-automation/` **state/recovery/lifecycle** — `StateEngine`, `RecoveryEngine`,
    `TaskEngine.resume/pause/cancel`, and the cross-process flag polling in
    `browser-task.processor.ts`. B has no equivalent for any of these.

**Project B — absolutely preserve (i.e. must be carried into the merge, not left behind):**

17. `packages/browser/selectorResolver.ts` — self-healing selection.
18. `packages/browser/interpolate.ts` — secret injection that never reaches logs.
19. `packages/automation-engine/*` — the workflow interpreter and per-node retry.
20. `packages/security/*` — `redactSecrets`, rate limiting, and the `select: false` discipline.
21. `packages/storage/*` — required for ZERO_COST local storage.
22. `packages/ai/safety.ts` — the AI agent kill switch.
23. `apps/worker/src/scheduler.ts` + `webhookDelivery.ts` + `health.ts`.
24. All eight tested files (`*.test.ts`) — they are the merged app's only existing test coverage.

**Safe to delete, with the stated precondition:**

- A `src/core/automation/` (Module 4) — **only after** `scene_video_auto` is re-pointed at the
  generic framework's Google Flow adapter, which already implements the same flow.
- B `apps/web/lib/auth.ts`, `apps/web/app/login/`, `packages/database/src/models/User.ts`,
  `packages/security/src/passwords.ts` — superseded by A's Auth.js.
- B `packages/database/src/models/ApiKey.ts` — superseded by A's `ApiToken`.
- B `apps/test-site/` — a dev fixture; optional, keep only if the e2e tests are ported.
- B `apps/web/components/{sidebar,topbar,theme-provider,mobile-nav}.tsx` — A's are richer.

---

## Audit conclusions carried into Phase 2

1. **Project A is correctly the primary application.** It is on newer everything, it is deployed,
   and it owns the domain (video production) that the merged product is named after.
2. **The browser-automation merge is not a copy — it is a graft.** A owns the run lifecycle;
   B owns the action layer, the workflow interpreter, and the safety rails. Both halves are needed.
3. **Three Playwright implementations must become one.** Module 4 is retired last, after
   `scene_video_auto` migrates.
4. **Two encryption formats is the highest-risk data issue**; cross-tenant leakage from B's
   untenanted models is the highest-risk security issue. Both are addressed before any B model
   is exposed through a route.
5. **Nothing in either project implements cost policy, provider health/quota metadata, a routing
   gateway, local image/voice generation, or HTML-based rendering.** Every one of the master
   task's §8–§14 items is genuinely new code, not a migration — and each must be feature-flagged
   off by default so the existing deployment is unaffected.
