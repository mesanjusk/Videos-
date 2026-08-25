# MERGE PLAN — AI Production OS

**Phase 2 deliverable.** Derived entirely from `docs/MERGE-AUDIT.md`. This is the plan the
implementation phases execute against; where it departs from the master task's suggested tree, the
reason is stated (Golden Rule: adapt to the existing project, don't force a tree).

---

## 0. Shape of the merged application

Project A stays a **single-package Next.js 15 application**. Project B's monorepo is dissolved:
its `packages/*` become directories under `src/core/`, its `apps/worker` folds into the existing
root `worker.ts`, its `apps/web` pages become route groups in `src/app/(dashboard)/`.

**Why not keep workspaces?** A is deployed on Vercel from a single package today, and B's own
`render.yaml` documents at length that the monorepo forced it onto Docker because Render's Node
buildpack could not resolve workspace siblings. Collapsing to one package removes that constraint
rather than importing it. It also means one `package.json`, one lockfile, one `tsconfig`, one
ESLint config — which is the concrete form of "no duplicate infrastructure".

## 1. Directory mapping (B → merged)

| Project B | Merged location | Notes |
|---|---|---|
| `packages/shared/src/enums.ts`, `errors.ts` | `src/core/browser/shared/` | zero-dep, drops in |
| `packages/shared/src/schemas/` | `src/core/browser/shared/schemas/` | zod, drops in |
| `packages/security/src/encryption.ts` | merged into `src/core/security/encryption.ts` | dual-format read (§6) |
| `packages/security/src/rateLimit.ts` | `src/core/security/rate-limit.ts` | new to A |
| `packages/security/src/apiKeys.ts` | **dropped** | A's `ApiToken` wins |
| `packages/security/src/passwords.ts` | **dropped** | A's Auth.js wins |
| `packages/storage/src/*` | `src/core/storage/{provider,local,cloudinary}.ts` | A's Cloudinary body kept |
| `packages/browser/src/session.ts` | `src/core/browser/session.ts` | replaces 7A `browser-manager`+`tab-manager` internals |
| `packages/browser/src/selectorResolver.ts` | `src/core/browser/selectors/resolver.ts` | verbatim |
| `packages/browser/src/interpolate.ts` | `src/core/browser/interpolate.ts` | verbatim |
| `packages/browser/src/actions.ts` | `src/core/browser/actions.ts` | verbatim |
| `packages/browser/src/pageSnapshot.ts` | `src/core/browser/page-snapshot.ts` | verbatim |
| `packages/automation-engine/src/*` | `src/core/automation/engine/` | **the folder A's Module 4 vacates** |
| `packages/ai/src/safety.ts` | `src/core/ai/safety.ts` | verbatim |
| `packages/ai/src/provider.ts`, `gemini.ts` | folded into `src/core/ai/gateway/` | becomes one LLM route among many |
| `packages/queue/src/*` | **dropped** | A's `core/queue/` wins; only `closeRedisConnection` ported |
| `packages/database/src/models/*` | `src/modules/<domain>/models/` | **each gains `userId`** (§4) |
| `apps/worker/src/scheduler.ts` | `src/core/automation/scheduler.ts` | called from `worker.ts` only |
| `apps/worker/src/webhookDelivery.ts` | `src/core/automation/webhook-delivery.ts` | + its test |
| `apps/worker/src/health.ts` | folded into `worker.ts` | `node:http`, not Express |
| `apps/worker/src/processor.ts` | `src/core/queue/processors/automation-workflow.processor.ts` | worker-only registry |
| `apps/web/lib/actions/*` | `src/app/api/…` route handlers + `src/modules/*/service.ts` | A's convention is services + routes |
| `apps/web/app/(dashboard)/*` | `src/app/(dashboard)/*` | ported to Next 15 async `params` |
| `apps/web/components/ui/primitives.tsx` | **dropped** | A's radix `components/ui/` wins |
| `docker-compose.yml`, `render.yaml`, keep-warm workflow, `preflight.mjs`, `vitest.config.ts` | root | adapted to single package |

## 2. Target `src/core/` after the merge

Adapted from the master task's §4 tree to A's actual conventions (`core/` = framework-free engines,
`modules/` = persistence + services). Folders marked **new** do not exist in either project.

```
src/core/
  ai/
    types.ts              (A, extended: capabilities, cost, health)
    registry.ts           (A, extended: fallback chains)
    gateway/              new — AiGateway, routing policy, OmniRoute client
    safety.ts             (B)
    providers/
      google/             (A, unchanged)
      ideogram/           new
      voicebox/           new
      local/              new — HTTP contract for a local image/TTS worker
  cost/                   new — CostPolicyService, ProviderCostPolicy
  production/             new — Production Director, pipeline definitions
  browser/                (B's browser package + A's 7A lifecycle)
    session.ts  actions.ts  interpolate.ts  page-snapshot.ts
    selectors/  manager/  state/  recovery/  monitoring/  providers/
  automation/             (A's Module 4 folder, repurposed)
    engine/               (B's automation-engine)
    scheduler.ts  webhook-delivery.ts  approvals.ts
  queue/                  (A, extended with new job types)
  quality/                (A, extended per §17 of the master task)
  render/                 new — RenderProvider abstraction
    ffmpeg.ts             (thin adapter over A's core/ffmpeg/compose.ts — compose.ts unmoved)
    hyperframes.ts        new
  storage/                (B's abstraction, A's Cloudinary body)
  security/               (A's + B's, unified)
  observability/          new — structured logging, correlation IDs
  db/ auth/ prompt-engine/ ffmpeg/ production-engine/ instagram/   (A, unchanged)
```

`core/ffmpeg/compose.ts` is **not moved and not edited** — `core/render/ffmpeg.ts` wraps it. This
is Rule 12 taken literally.

## 3. Unified job types

Extends A's `JOB_TYPES` (`src/modules/jobs/models/Job.ts`). Existing 11 types are unchanged.

| Job type | Registry | Why |
|---|---|---|
| *existing 11* | as today | no behaviour change |
| `production.plan` | shared | Director planning, LLM only |
| `production.research` | shared | LLM/HTTP only |
| `production.finalize` | shared | bookkeeping |
| `automation.workflow` | **worker-only** | Playwright |
| `automation.schedule` | shared | enqueues, does not execute |
| `automation.webhook` | shared | HTTP only |
| `browser.task` | **worker-only** | renamed alias kept for `browser_task` |
| `system.cleanup` | shared | storage/DB sweep |

Retry policy per type: existing types keep `attempts: 3`. `automation.workflow` and `browser.task`
get **`attempts: 1`** — the workflow engine retries per node (audit §8/§22); stacking BullMQ retries
on top would re-run completed steps.

Cross-cutting additions to every job: `correlationId`, `parentJobId`, `provider`, `model`,
`costPolicy`, `estimatedCost`, `actualCost`, `startedAt`/`completedAt`/`duration` — added to the
`Job` schema as optional fields so existing documents remain valid.

## 4. Database plan

**No existing A collection is renamed, dropped, or restructured.** All changes are additive.

New collections (B models, each gaining `userId: { type: String, required: true, index: true }` to
match A's tenancy — audit §29.4, the highest-severity risk):

`BrowserProfile`, `Credential`, `Workflow`, `WorkflowVersion`, `Automation`, `AutomationTask`
(B's `Task`, renamed to avoid colliding with the concept of a BullMQ job), `Execution`,
`ExecutionStep`, `Schedule`, `Webhook`, `HumanIntervention`, `StoredFile` (B's `File`, renamed —
`File` is a DOM global and a confusing model name), `AuditLog`, `ProviderConfig`, `QualityReport`.

Dropped from B: `User` (Auth.js owns users), `ApiKey` (A's `ApiToken` wins), `AIRequest`
(superseded by the new per-job cost/observability fields).

**Deduplication decisions:**
- A's `BrowserSession` (storageState) is **merged into** B's `BrowserProfile` — B's has
  userAgent/viewport/locale/timezone/status; A's has `providerId` + `userId`. The union is one
  collection. A migration copies existing `BrowserSession` rows across and re-encrypts them.
- A's `BrowserTaskRun` is **kept** (it holds `taskDefinition` + resume state) and gains a link to
  `Execution`/`ExecutionStep` for per-step detail. A's `BrowserExecutionLog` is superseded by
  `ExecutionStep` and retained read-only until the migration is confirmed.

Migrations live in `scripts/migrations/` and are idempotent and non-destructive: they copy and
verify, never drop. Nothing deletes data.

## 5. Provider abstraction plan

Extend, do not replace, `src/core/ai/types.ts`. Every provider interface gains:

```ts
interface ProviderCapabilities { /* per-capability feature flags */ }
interface ProviderCostPolicy {
  isFree(): boolean;
  requiresPayment(): boolean;
  estimatedCost(input: unknown): number | "unknown";
  quotaRemaining(): Promise<number | "unknown">;
  canRunInZeroCostMode(): boolean;   // false whenever cost is "unknown"
}
interface ProviderDescriptorV2 {
  id; label; capability; enabled;
  capabilities: ProviderCapabilities;
  requirements: string[];            // env vars / binaries / services needed
  cost: ProviderCostPolicy;
  health(): Promise<"up" | "down" | "unknown">;
  rateLimit?: { perMinute?: number; perDay?: number };
  fallbacks: string[];               // ordered provider ids
}
```

Existing providers implement this with a default "paid/unknown" cost policy — **which means they
are blocked in ZERO_COST until explicitly classified.** That is the intended fail-closed direction
(master task §9: "If provider pricing cannot be verified, treat it as NOT ZERO-COST").

`AiGateway` sits in front of `registry.ts`: business logic calls `gateway.generateImage(...)`, the
gateway consults `CostPolicyService` + health + quota, picks a route (local → OmniRoute → direct
API), and falls back down the chain. It never falls back *up* the cost ladder.

## 6. Encryption migration (audit §29.3)

A's format: `base64(iv):base64(tag):base64(ct)`. B's: `base64(iv‖tag‖ct)`.

One `src/core/security/encryption.ts` with:
- `encrypt()` — writes **A's** format (existing production rows stay readable by old code during
  rollout).
- `decrypt()` — detects the format by the presence of `:` and reads **both**.
- Key resolution: `ENCRYPTION_KEY` preferred, falling back to `ACCOUNTS_ENCRYPTION_KEY`, so
  existing deployments keep working with no env change.

No re-encryption pass is required; the dual reader makes it unnecessary.

## 7. Feature flags

Every new integration is off by default. Defaults chosen so that a deployment that pulls this merge
and changes **no** environment variables behaves exactly as it does today.

| Flag | Default | Effect when off |
|---|---|---|
| `ENABLE_ZERO_COST_MODE` | `false` | cost policy always `BALANCED`; no gating |
| `ENABLE_OMNIROUTE` | `false` | gateway skips the OmniRoute route |
| `ENABLE_VOICEBOX` | `false` | provider reports unavailable |
| `ENABLE_IDEOGRAM` | `false` | provider reports unavailable |
| `ENABLE_HYPERFRAMES` | `false` | renderer registry contains FFmpeg only |
| `ENABLE_LOCAL_AI` | `false` | local providers unavailable |
| `ENABLE_BROWSER_FALLBACK` | `false` | `scene_video` never diverts to browser automation |
| `ENABLE_WORKFLOW_AUTOMATION` | `true` | B's browser automation UI/API (A already ships a browser-automation page; keeping it on preserves current behaviour) |

A provider whose flag is off, or whose required env var is missing, must report **unavailable** —
never throw at import time, never fail a build.

## 8. Deployment plan

Unchanged for Vercel (Rule 15): same `vercel.json`, same two-registry split, same
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. The merge adds no new dependency reachable from a
Vercel-hosted route — verified by keeping every Playwright/FFmpeg/HyperFrames import behind
`worker-only-processors.ts`.

Added: `docker-compose.local.yml` (mongo + redis + app + worker), `npm run dev:all`,
an adapted `render.yaml` for the worker, and the keep-warm workflow.

## 9. Execution order

Phases follow the master task's §33. Each lands as its own commit on
`claude/merge-video-browser-automation-l89zmt`, and each must leave `npm run build` and
`npm run typecheck` green — the merge is never allowed to sit in a broken state.

| Phase | Content | Risk |
|---|---|---|
| 1–2 | Audit + this plan | done |
| 3 | Checkpoint tag | none |
| 4 | Port B's dependency-free layers: shared enums/errors/schemas, security, storage abstraction, vitest | low |
| 5 | Dedupe: one Redis, one Mongo, one encryption, one storage | medium — touches live paths |
| 6 | Unify browser automation: B's actions/selectors/interpolation into A's framework | **high** |
| 7 | Unify workers: absorb scheduler, health, webhook delivery, graceful shutdown | medium |
| 8 | Provider abstraction v2 + `AiGateway` | medium |
| 9 | OmniRoute route (flagged) | low |
| 10 | Production Director + pipeline definitions | medium |
| 11–13 | Voicebox, HyperFrames, Ideogram providers (all flagged) | low each |
| 14 | ZERO_COST mode + `CostPolicyService` + the cost-safety test | medium |
| 15–16 | Local worker mode; browser fallback for video (flagged) | medium |
| 17 | Quality verification additions + per-stage retry | medium |
| 18 | Unified dashboard nav + one-line "Create Video" | low |
| 19 | `.env.example` regrouped | low |
| 20–22 | Test suite, production build, deployment docs | — |

## 10. Explicit non-goals

Stated up front so they are not mistaken for omissions:

- **No OpenMontage source is copied** (Rule 11). Pipelines-as-data is implemented independently.
- **FFmpeg is not touched** (Rule 12). `compose.ts` is not edited in any phase.
- **A's quality/retry system is not replaced** (Rule 13) — only extended.
- **B's credentials login is not carried over.** Adding a second authentication path to a
  multi-tenant app is a regression, not a feature.
- **No paid API is called anywhere by default**, and no provider is classified as free without
  a verifiable basis. Unknown cost = blocked in ZERO_COST.
- Any integration whose external dependency is unavailable in this environment (a GPU, an
  OmniRoute instance, a Voicebox server, an Ideogram key) ships as a **working abstraction with a
  documented missing dependency** — never a stub pretending to succeed.
