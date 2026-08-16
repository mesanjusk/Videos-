# AI Video Studio — Architecture

Source of truth for workflow logic: `COMPLETE_AI_CARTOON_WORKFLOW_2026.pdf` (10-step pipeline:
Story → Characters → Backgrounds → Scenes → Images → Videos → Voice → Lip Sync → Music → Editing →
Thumbnail → Upload). This document defines how that workflow is implemented on the approved stack,
provider-agnostically, for a multi-user SaaS.

## 1. Non-negotiable technology decisions

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js 15, App Router | Server Components by default, Server Actions for mutations that don't need job semantics |
| Language | TypeScript, strict mode | no `any` in domain/service code |
| Styling | Tailwind CSS + shadcn/ui | design tokens in `tailwind.config.ts`, primitives copied into `src/components/ui` |
| Motion | Framer Motion | page/step transitions, skeleton → content swaps |
| Icons | lucide-react | every actionable button carries one |
| Forms | React Hook Form + Zod resolvers | one schema per form, shared with the API route's Zod schema |
| Validation | Zod | validated at every API boundary, never trust client input |
| DB | MongoDB Atlas (free M0) via Mongoose | see §4 |
| Object storage | Cloudinary (free tier) | all binary assets — images, video, audio, thumbnails |
| Auth | Auth.js (NextAuth v5) + Google OAuth | session = app login; **separate** from the Google Account Manager (§6) |
| Queue | BullMQ + Upstash Redis (free tier, TLS) | see §7 for the Vercel-serverless adaptation |
| Video compose | FFmpeg (`fluent-ffmpeg` + `ffmpeg-static`) | runs only inside queue processors, never in a request handler; `ffmpeg-static` ships a current (7.x) build — verified against the alternative `@ffmpeg-installer/ffmpeg` package, whose pinned 2018 static binary lacks the `xfade` filter transitions need |
| Image ops | Sharp | thumbnail crops/resizes, turnaround-sheet compositing |
| Hosting | Vercel (Hobby/free) | Cron for queue ticks; no long-lived processes |

Everything is chosen to run on free tiers end-to-end (Atlas M0, Upstash free 10k cmds/day, Cloudinary
free 25 credits/mo, Vercel Hobby). The architecture must degrade gracefully (queue backpressure,
clear "quota exhausted" states) rather than assume paid capacity.

## 2. AI provider abstraction (the core rule: never hardcode a provider)

Four capabilities, four interfaces, one registry. Nothing outside `src/core/ai` imports a vendor SDK.

```
src/core/ai/
  types.ts        — StoryProvider, ImageProvider, VideoProvider, VoiceProvider interfaces
  registry.ts      — capability -> provider instance, resolved from DB Settings + env fallback
  providers/
    google/
      gemini-story.ts     implements StoryProvider   (Gemini text)
      gemini-image.ts     implements ImageProvider   (Gemini image / Imagen)
      gemini-voice.ts     implements VoiceProvider   (Gemini TTS)
      google-flow-video.ts implements VideoProvider  (see below — manual hand-off)
    openai/ claude/ flux/ runway/ kling/ veo/ local/   — future, empty stubs registered but disabled
```

Every provider is registered by a string id (`"gemini"`, `"google-flow"`, …) in `registry.ts`. Which
id backs which capability is a **runtime setting** (`Settings` collection, editable from
`/settings`), with an env var as the bootstrap default. Adding a new provider means adding one file
that implements the interface and one registry line — zero changes to routes, services, queue
processors, or UI.

### Why "Google Flow" is modeled as a manual hand-off, not an API call

Google Flow (labs.google/flow) has no public developer API — Veo is only programmatically reachable
via Vertex AI, and the brief explicitly forbids using Veo *except* through Flow. So `VideoProvider`
returns a discriminated union:

```ts
type VideoGenerationResult =
  | { status: "completed"; videoUrl: string }                      // future API-backed providers
  | { status: "manual_pending"; taskId: string; promptText: string } // google-flow today
```

`GoogleFlowVideoProvider.generateVideo()` assembles the Step-5 prompt formula from the PDF (reference
character + action + camera + lighting + emotion + duration + style), persists a `Job` in
`manual_pending`, and the UI shows the operator: "Copy this prompt into Google Flow, download the
clip, then drop it here." A signed Cloudinary upload widget completes the job
(`completeManualUpload`), after which the pipeline continues exactly as if an API had returned the
clip. This keeps the rest of the system (queue, scene state machine, editor) completely unaware that
one step is human-in-the-loop — swapping in a future API-backed video provider (Veo via Vertex,
Runway, Kling — once permitted) requires no change outside that one provider file.

## 3. Google Account Manager (separate from app auth)

Two distinct identities must not be conflated:

1. **App session** — how a creator logs into the SaaS (NextAuth Google OAuth, one account, standard
   session cookie).
2. **Generation accounts** — a *pool* of Google accounts (Gemini API keys / OAuth-consented accounts)
   the app rotates across when calling Gemini/Flow on the user's behalf, to spread free-tier quota.

`GoogleAccount` model (owned by the app user, never shared across users):

```ts
{
  userId, email, displayName, avatarUrl,
  // The Gemini Developer API (free tier) authenticates with a per-account API key issued in
  // AI Studio, not a raw OAuth access token, so that's what's stored — AES-256-GCM encrypted at
  // rest with ACCOUNTS_ENCRYPTION_KEY, decrypted only inside modules/accounts/service.ts.
  credentials: { apiKeyEnc: string },
  status: "active" | "disabled" | "quota_exceeded" | "error",
  isDefault: boolean,
  quota: { dailyLimit, used, resetsAt, lastError },
  lastUsedAt, currentJobIds: [ObjectId],
}
```

Connecting an account is a two-step UX: (1) standard Google OAuth consent (via NextAuth's Google
provider, reused for identity — confirms *which* Google account this is and fetches
email/name/avatar) followed by (2) the user pasting the Gemini API key they generated for that same
account at aistudio.google.com (the app links directly to it). Both steps are necessary because
OAuth alone doesn't produce a Gemini-API-callable credential on the free tier.

`core/ai/registry.ts` never talks to a single fixed credential — for Google-backed providers it asks
`modules/accounts/selector.ts` for the next usable account:

- Filters to `status: "active"` and `quota.used < quota.dailyLimit`.
- Picks least-recently-used (round robin), preferring `isDefault` only as a tiebreak.
- On a 429/quota error from the SDK, marks that account `quota_exceeded` with `resetsAt`, **requeues
  the same job** against the next account instead of failing it, and only surfaces a hard failure to
  the user when every account in the pool is exhausted — with a clear "wait until \<time\>" or "add
  another Google account" prompt.
- A job never loses its place in `currentJobIds` mid-run; account switch happens between attempts, not
  by killing in-flight work.

Tokens are encrypted with a server-side key (`ACCOUNTS_ENCRYPTION_KEY`), decrypted only inside
`modules/accounts/service.ts`, never sent to the client.

## 4. Data model (MongoDB Atlas, Mongoose)

```
User            { authProviderId, email, name, image, settingsId }
Settings        { userId, providerOverrides: { story, image, video, voice }, theme, defaultLanguage }
GoogleAccount   (see §3)
Project         { userId, title, language, videoType, duration, targetPlatform, style,
                  status: "draft"|"story"|"characters"|"backgrounds"|"scenes"|"rendering"|"done",
                  storyJson, completionPercent }
Character       { projectId, name, spec{age,bodyType,face,eyes,hair,clothes,shoes,accessories,personality},
                  sheetAssets[{pose, assetId}], voiceProfile, promptTemplateId, version, previousVersions[] }
Background      { projectId, name, category, description, style, assetId, promptTemplateId }
Scene           { projectId, index, visual, dialogue, camera, emotion,
                  characterIds[], backgroundId,
                  imageAssetId, videoAssetId, voiceAssetId,
                  videoTaskId,                      // manual_pending hand-off tracking
                  status: "pending"|"image_queued"|"image_ready"|"video_pending_manual"|
                          "video_ready"|"voice_queued"|"voice_ready"|"complete"|"failed" }
Job             { userId, projectId, sceneId?, type: "story"|"character_image"|"background_image"|
                  "scene_image"|"scene_video"|"voice"|"render"|"thumbnail",
                  status: "queued"|"running"|"manual_pending"|"completed"|"failed",
                  attempts, googleAccountId?, payload, result, error, progress, logs[] }
Asset           { userId, projectId, kind: "image"|"video"|"audio"|"music"|"thumbnail"|"final_video",
                  cloudinaryPublicId, url, width, height, durationSeconds, version, replaces?: AssetId }
PromptTemplate  { userId, scope: "story"|"character"|"background"|"scene_image"|"scene_video"|
                  "voice"|"thumbnail", name, template, variables[], isDefault }
```

`completionPercent` on `Project` and `status` on `Scene`/`Job` are what drive the "always show the
next recommended action" UX requirement — computed server-side, not re-derived ad hoc in components.

## 5. JSON engine

Nothing downstream of story generation is free text. The story step returns and persists:

```ts
interface StoryJson {
  title: string;
  language: string;
  characters: { name: string; role: string }[];
  scenes: {
    index: number; visual: string; dialogue: string; camera: string; emotion: string;
  }[];
}
```

This becomes the single `Scene` documents (§4). Every later prompt (character sheet, background,
scene image, scene video, voice line, thumbnail) is *derived* from these fields via the prompt engine
(§8), never re-typed. Editing `Scene.camera` in the UI invalidates and regenerates only the prompts
that depend on `camera` (scene image, scene video) — dependency edges are declared per template (§8),
so a field edit recomputes exactly the downstream prompts that reference it, not the whole project.

## 6. API surface

REST-ish route handlers under `src/app/api`, one Zod schema per route shared with the calling form.
Long-running AI/render work is never done inline in a route handler — the route validates input,
writes a `Job` (status `queued`), enqueues it on the relevant BullMQ queue, and returns `202` with the
job id. Server Actions are used only for simple CRUD (rename project, delete character) that completes
in one DB round trip.

```
/api/auth/[...nextauth]                          NextAuth
/api/accounts                    GET/POST         list / add Google account (OAuth consent flow)
/api/accounts/[id]               PATCH/DELETE      enable/disable/set-default / remove
/api/projects                    GET/POST
/api/projects/[id]               GET/PATCH/DELETE
/api/projects/[id]/story         POST              -> enqueue "story" job
/api/projects/[id]/characters    GET/POST
/api/characters/[id]/sheet       POST              -> enqueue "character_image" job
/api/projects/[id]/backgrounds   GET/POST          -> enqueue "background_image" job
/api/projects/[id]/scenes        GET
/api/scenes/[id]                 PATCH             edit fields, triggers dependency recompute (§5)
/api/scenes/[id]/image           POST              -> enqueue "scene_image" job
/api/scenes/[id]/video           POST              -> enqueue "scene_video" job (may resolve manual_pending)
/api/scenes/[id]/video/upload    POST              completes a manual_pending video job (Cloudinary URL)
/api/scenes/[id]/voice           POST              -> enqueue "voice" job
/api/projects/[id]/render        POST              -> enqueue "render" job (ffmpeg compose)
/api/projects[id]/thumbnail      POST              -> enqueue "thumbnail" job
/api/jobs                        GET               list current user's jobs (dashboard "Current Jobs")
/api/jobs/[id]                   GET/DELETE        poll status / cancel
/api/prompt-templates            GET/POST/PATCH
/api/queue/tick                  POST (cron only)  bounded-time BullMQ worker run, see §7
```

## 7. Queue system on Vercel

BullMQ's `Worker` is a persistent process — Vercel functions are not. The adaptation:

- Producers (route handlers) `queue.add(...)` as normal; this is a fast Redis call, works fine in a
  serverless function.
- Consumption happens in `/api/queue/tick`, invoked two ways:
  1. **Vercel Cron** (`vercel.json`, once daily) — the backstop, not the heartbeat (see below for why).
  2. **Fire-and-forget self-call** immediately after a route enqueues a job — this is what actually
     drives near-real-time processing; see the honesty note.
- Inside the tick handler: construct a `Worker` per queue with `autorun: false`, call `worker.run()`,
  and `worker.close()` after a fixed time budget (`QUEUE_TICK_BUDGET_MS`, default 45s, safely under
  Vercel's function timeout) or when no jobs remain, whichever is first. This is the standard
  "poll-and-drain" pattern for running BullMQ on serverless.
- Processors live in `src/core/queue/processors/*`, each a pure function `(job) => Promise<result>`
  that calls the resolved AI provider (§2/§3), uploads results to Cloudinary (§storage), and updates
  the owning `Scene`/`Project`/`Job` documents.
- If self-hosting/always-on hosting is available later, `worker.ts` at the repo root runs the same
  processors as a true long-lived Worker — the processor functions are host-agnostic by design.
- **Free-tier honesty:** Vercel Hobby doesn't just throttle sub-daily Cron Jobs, it refuses to deploy
  them at all — `vercel.json` originally declared `* * * * *` (every minute) and the Hobby deploy UI
  hard-blocked it with `Hobby accounts are limited to daily cron jobs`, no partial/degraded fallback.
  `vercel.json` now declares `0 0 * * *` (once daily) so the project actually deploys on Hobby; that
  makes the cron backstop close to useless on this plan, and the fire-and-forget self-call after
  enqueue is doing essentially all the real work. That self-call is a plain HTTP request, not a
  Vercel platform feature, so it works identically on every plan. For a real sub-minute backstop on
  Hobby (covering jobs whose self-call failed), point a free external pinger — e.g. cron-job.org — at
  `/api/queue/tick` instead of depending on `vercel.json`'s schedule. Upgrading to Pro removes the
  restriction and lets `vercel.json` go back to a per-minute schedule.

## 8. Prompt engine

Single source for every prompt string in the system — no template text lives inline in a provider or
route.

```
src/core/prompt-engine/
  types.ts       PromptTemplate, PromptContext, TemplateVariable
  engine.ts       render(template, context) -> string   (Handlebars-style {{variable}} substitution + the
                   PDF's "Character Consistency Formula" auto-appended to every image/video template)
  templates/       one default template per scope (story, character, background, scene_image,
                   scene_video, voice, thumbnail) seeded from the PDF's exact prompt formulas,
                   translated onto the approved providers
```

- Templates are stored per-user in `PromptTemplate` (seeded from the defaults above on first use) so
  "all prompts should be editable" — the Settings/Prompt Library UI edits these documents directly.
- `variables[]` on each template declares which `Scene`/`Character`/`Project` fields it reads; this is
  the dependency graph that drives selective re-generation (§5).
- The Character Consistency Formula block (identical facial features / hairstyle / clothes / body
  proportions / colors / accessories / Pixar-quality 3D / cinematic lighting / 1080×1350) is a shared
  partial injected into every character/background/scene/thumbnail template, per the PDF, not
  duplicated per template.

## 9. Editing pipeline (FFmpeg, in a queue processor only)

`core/ffmpeg/compose.ts`: download scene clips + voice tracks + an optional music track from
Cloudinary into `/tmp` (ephemeral, cleaned per invocation) → per-clip scale/crop to portrait + a
gentle Ken Burns zoom (`zoompan`) → `xfade` transitions chaining clips in scene order → per-scene
narration built from each scene's voice track (or exact silence where a scene has none) chained with
matching `acrossfade` crossfades so audio stays in sync with the video transitions → mix in the music
bed if provided (`amix`) → burn captions from `Scene.dialogue` (via the `subtitles`/libass filter,
timed off the same transition-aware offsets — not `drawtext`, see below) → overlay a logo/watermark
image if configured → export `1080×1920, 30fps, H.264/AAC` → upload the result to Cloudinary as an
`Asset(kind: "final_video")` → mark `Project.status = "done"`. Runs exclusively inside the `render`
queue processor (never in a request handler) because it is CPU- and time-heavy.

This exact filter graph was hand-verified against synthetic clips (mismatched resolutions/framerates,
mixed voiced/silent scenes, with and without music/watermark) before being wired in — two
implementation details worth flagging:

- **`ffmpeg-static`, not `@ffmpeg-installer/ffmpeg`.** The latter's pinned static binary is from 2018
  and has no `xfade` filter, which transitions depend on. Verified directly; swapped packages rather
  than discovering it in production.
- **Captions burn via the `subtitles` filter (libass), not `drawtext`.** The `ffmpeg-static` build
  doesn't compile in `drawtext` at all, so a generated `.srt` + `subtitles=...:force_style=...` is
  used instead — which is also the more correct approach for genuinely timed captions anyway.
- **No music-generation provider.** The PDF's Music step (Suno/Udio/Epidemic Sound/Artlist) has no
  approved-stack replacement — none of those tools are allowed, and the brief lists no
  music-generation AI provider at all. Rather than reach for a forbidden tool or invent an
  unapproved one, background music is a user-supplied upload (`Project.musicAssetId`), optional and
  skipped in the render if absent.

## 10. Folder structure

```
src/
  app/                      routes only — thin handlers, no business logic
    (marketing)/            landing page
    (auth)/login/
    (dashboard)/            authenticated shell: dashboard, projects, accounts, settings
    api/                    route handlers per §6
  modules/                  feature-based domain modules (model + service per feature)
    accounts/ projects/ characters/ backgrounds/ scenes/ jobs/ assets/ prompt-templates/ api-tokens/ (§16)
  core/                     cross-cutting, host-agnostic
    ai/                     provider interfaces + registry + vendor implementations (§2)
    prompt-engine/          §8
    queue/                  connection, queue defs, tick runtime, processors (§7)
    ffmpeg/                 §9
    browser-automation/     Module 7A's provider-agnostic framework (§13)
    browser-automation-providers/google-flow/  Module 7B's ProviderAdapter (§17) — worker-only, never core/browser-automation/'s own import
    storage/                cloudinary.ts (upload, signed-upload params, delete)
    db/                     mongoose.ts (cached connection), mongo-client.ts (native, NextAuth adapter)
    auth/                   NextAuth config, session helpers, encryption util for §3, requireUserId() Bearer support (§16)
  components/
    ui/                     shadcn primitives
    shared/                 Stepper, EmptyState, LoadingSkeleton, HelpButton, ProgressBar, JobBadge
    layout/                 Sidebar, Topbar, ThemeToggle, CommandPalette
  hooks/                    useProject, useJobPolling, useProviderSettings, ...
  lib/                      utils.ts (cn, formatters), constants.ts
  types/                    shared TS types not owned by a module
worker.ts                   optional standalone worker (self-hosted fallback, §7)
plugin/                     Claude Code plugin driving this app's API end to end (§16)
docs/                       database-schema.md, api-reference.md, deployment.md, roadmap.md
```

Rule: `app/` never imports a vendor SDK or touches Mongoose models directly — it calls into
`modules/*/service.ts`, which is the only layer allowed to talk to `core/db`. This keeps API routes
and Server Components thin and testable, and is what lets `core/ai` providers be swapped without
touching anything above it.

## 11. Delivery plan (why this isn't shipped as one giant diff)

1. **Architecture (this document) + scaffold** — repo/config, `core/ai` abstraction, `core/db` models,
   Google Account Manager module. *(this commit)*
2. Auth + dashboard shell + project wizard (Steps 1–4 of the creation flow).
3. Story + Character + Background generation (Gemini providers wired through the queue).
4. Scene Manager + scene image/video generation (incl. the Google Flow manual hand-off UI).
5. Voice + FFmpeg render pipeline + thumbnail generator.
6. Prompt Library, Settings, polish pass (empty states, skeletons, animations, dark mode).

Each lands as its own reviewable commit on `claude/video-studio-architecture-wruz2h`.

## 12. Automation modes (2026-08 addition)

`Project.pipelineMode` (`"full" | "semi" | "manual"`, default `"semi"`) governs how much of the
10-step pipeline runs unattended, per the workflow PDF's three usage patterns:

- **Semi** (default, unchanged behavior): every step is user-triggered, same as before this field
  existed.
- **Full**: `core/queue/orchestrator.ts` auto-enqueues the next step as soon as its prerequisite
  exists — scene image → scene video → voice → lip sync → render → thumbnail — and auto-assigns a
  scene's characters/background (all ready characters + the first ready background, a blunt
  heuristic, not per-scene curation) the first time material exists. It deliberately never invents a
  Character/Background from scratch (their spec needs real creative input — age/body/face/clothes —
  that the story step doesn't produce) and never proceeds past a manual hand-off on its own; the
  chain resumes automatically once a human completes that upload.
- **Manual**: identical to semi at the queue level; the distinction is that it leans on named,
  reusable Prompt Library presets (`modules/prompt-templates`, one `{userId, scope, name}` doc per
  preset, unique per scope) rather than one-off template edits.

**Lip sync (PDF Step 7)** is now a fourth provider capability (`core/ai/types.ts`'s
`LipSyncProvider`), following the exact `VideoProvider` manual-hand-off shape: no approved-stack
provider (Hedra/HeyGen/Kling Lip Sync) has a free API, so `ManualLipSyncProvider` always returns
`manual_pending` and `POST /api/scenes/:id/lipsync/upload` completes it once a human uploads the
synced clip. `render.processor.ts` prefers a scene's lip-synced clip over its separate video+voice
tracks when one exists (`compose.ts`'s `useEmbeddedAudio` — the clip's own audio already has the
narration baked in).

**Music (PDF Step 8)** gained a `music` prompt-template scope — a copy-pasteable Suno/Udio-style
prompt shown next to the existing manual upload — but not a provider, since Suno/Udio have no public
developer API to call.

**Not done in this pass** (explicitly out of scope, needs external setup this deployment doesn't
have): wiring a real paid API for video (Runway/Kling), lip sync (Hedra/HeyGen), or music generation
(no free/API-accessible option exists for the last one) — each is a single new file under
`providers/<vendor>/` plus flipping `enabled: true` on its `FUTURE_PROVIDERS` entry in
`core/ai/registry.ts` once a key exists; and platform upload/export (YouTube Data API is the only
one of the three PDF platforms with a free, non-gated upload API, but needs a verified OAuth consent
screen configured outside this codebase before it can be wired in).

## 13. Browser Automation Engine (2026-08 addition)

An optional, opt-in second path for the Google Flow video step (§2): Playwright drives Flow's actual
web UI end to end (open project, upload references, paste prompt, generate, download) instead of a
human running those same steps by hand. The manual hand-off from §2 is unchanged and stays the
default — automation is strictly additive.

**Why this is a separate job type/queue, not a `VideoProvider` swap in the shared registry.**
`core/ai/registry.ts` is imported by every route and by the shared `processorRegistry`
(`core/queue/processors/index.ts`), which both the Vercel-serverless tick (`/api/queue/tick`) and the
standalone `worker.ts` consume. A Playwright-based provider registered there would get bundled into
Vercel serverless functions — no guaranteed Chromium binary, unsuited execution time limits for a
multi-minute browser session, unnecessary bundle weight. So automation lives entirely outside that
import graph:

- `core/automation/` (Playwright session management, the Flow driver, centralized selectors) and
  `core/ai/providers/google/google-flow-automated.ts` (the automation-backed generator) are never
  imported by `core/ai/registry.ts`.
- A distinct job type, `scene_video_auto`, has its own processor
  (`core/queue/processors/scene-video-auto.processor.ts`) registered only in
  `core/queue/worker-only-processors.ts` — a registry **only `worker.ts` imports**, never
  `core/queue/worker-runtime.ts` (which backs the Vercel tick route). Confirmed via `next build`:
  none of `core/automation/*` appears in any route's server bundle or build trace.
- If `worker.ts` isn't running when a `scene_video_auto` job is enqueued, it just sits `queued` —
  visible on `/queue` (§ Scene Queue) — until a worker picks it up. An honest degrade, not a silent
  failure, and consistent with how `render` jobs already lean on `worker.ts` for the same
  serverless-time-limit reason (§7).

**Why the Google login itself is never automated.** Typing real Google credentials into Google's own
login form via a headless browser is exactly the pattern Google's abuse detection exists to catch,
and it would make this codebase responsible for handling 2FA, consent screens, and account lockouts
it has no business touching. Instead, `GoogleAccount.credentials.flowSessionStateEnc` stores a
Playwright `storageState()` export (cookies + localStorage) from a session where the operator logged
in manually, exactly once, outside the app (`npx playwright codegen labs.google/flow`) — encrypted
at rest the same way as the Gemini API key (`core/auth/encryption.ts`), decrypted only inside
worker-only code. The Accounts page's "Connect Flow browser session" flow is just pasting that JSON
in; `modules/accounts/service.ts#findAccountWithFlowSession` finds an account with one connected.

**The circuit breaker.** `AutomationCircuitBreakerError` (`core/automation/errors.ts`) is thrown for
anything automation should never push through blindly: the session looks logged out, an expected
selector isn't there (Flow's DOM changed, or a verification/CAPTCHA challenge appeared), or a step
ran past its bounded timeout. `google-flow-automated.ts` catches exactly this error type and returns
the identical `manual_pending` shape the plain manual provider returns — the Scene state machine and
hand-off upload UI never know or care which path produced it. Only a genuinely unexpected error (the
browser itself failing to launch, say) is allowed to fail the job outright.

**Honest caveat on selectors.** `core/automation/selectors.ts` centralizes every CSS/text selector
the driver depends on — but labs.google/flow has no public API and no documented DOM contract, and
this codebase has no real Google account or network path to it to verify against. The selectors
shipped are best-effort placeholders, clearly marked as needing calibration by an operator with real
Flow access before production use. The driver's control flow (`google-flow-driver.ts`) doesn't need
to change when they're corrected — only that one file does.

## 15. AI Production Engine (2026-08 addition)

The orchestration layer that lets a producer pick a **Production Profile** and generate a whole
project from just a topic — see `docs/PRODUCTION-ENGINE-PLAN.md` for the full audit/design writeup.
Four new collections (`ProductionProfile`, `StylePack`, `VoicePack`, `ProductionRun`), all
*referencing* Modules 1–5's existing data rather than duplicating it:

- `ProductionProfile.characterIds` → Character Library (§Module 1) — no character is ever copied.
- `ProductionProfile.promptTemplateIds` → specific named `PromptTemplate` presets (already
  multi-preset-per-scope) — no prompt text is ever duplicated.
- `ProductionProfile.stylePackId` → `StylePack`, folded into `Project.customStyleDescription` at
  generation time (`core/production-engine/style-description.ts`) — the existing "Custom" style
  mechanism every image/video processor already reads, so no processor needed a style-specific
  change for style packs to work.
- `ProductionProfile.quality` → resolved by `core/production-engine/resolve-quality-targets.ts` in
  place of Module 5's hardcoded resolution/duration/consistency-threshold constants, falling back
  to those exact constants for any project with no profile — zero behavior change otherwise.
- `ProductionProfile.render` (`maxParallelJobs`, `providerOverrides`, retry/recovery strategy) is
  stored but deliberately **not consumed** by any processor yet — an abstraction layer for a future
  rendering backend, not a browser-automation change; explicitly out of scope for this module.

`core/production-engine/generate.ts` is the single "topic → Generate" entry point: creates a
`Project` from the profile's defaults, assigns its characters (Module 1's
`assignCharacterToProject` — links in, never copies), pins prompt presets via a new optional
`Project.promptTemplateOverrides` field (`resolveActiveTemplate` gained one optional parameter,
default `undefined`, so every existing call site is unaffected), sets `pipelineMode: "full"`, and
enqueues the story job. Everything after that — scene image → video → voice → lipsync → render →
thumbnail — is `core/queue/orchestrator.ts`'s existing full-auto chain, unmodified.

**Pipeline stage is derived, not duplicated.** `core/production-engine/compute-stage.ts` computes a
run's live stage (planning/ready/generating/rendering/quality_check/retry/completed/failed) from
real `Project.status`/`Scene.status`/`Job.status` data — the same precedent
`lib/workflow-steps.ts#computeStepStatuses` already established for the landing page's workflow
wheel. `ProductionRun.stage` in the database only ever holds `"planning"` (at creation) or
`"completed"` (written once, from a small addition to `onRenderCompleted`) — there is no second,
separately-maintained state machine that could drift out of sync with the real one.

**A real bug this caught during implementation**: a client form component importing the profile's
Zod schema transitively imported the Mongoose model file (for one shared enum constant), pulling
Mongoose into the browser bundle — `/production-profiles` briefly built at 327 kB First Load JS.
Fixed with the same mongoose-free `constants.ts` pattern `modules/projects/constants.ts` already
uses for exactly this reason; confirmed back to 185 kB via `next build`.

## 14. Quality Verification + Auto Retry (2026-08 addition)

Deterministic checks (`core/quality/checks.ts`) instead of trusting every generation call's output
at face value:

- `checkImageResolution` compares Cloudinary's *measured* width/height post-upload against the
  4:5 (1080×1350) / final-render (1080×1920) targets this document already declares — deliberately
  not the generation provider's self-reported dimensions (`gemini-image.ts` currently hardcodes
  `width: 1080, height: 1350` regardless of what Gemini actually returned; checking a claim against
  itself would prove nothing).
- `checkVideoDuration` against the PDF's 5-8s scene-clip clamp.
- `checkSceneCompleteness` flags a scene whose `status` implies an asset (image/video/voice) it
  doesn't actually have — a read-only integrity check, not a retry trigger.

**Auto Retry is a refactor of existing machinery, not a new system.** `QualityCheckFailedError`
(`core/quality/errors.ts`) is thrown from inside the same processor `run()` callback every other
processor error already flows through
(`core/queue/processors/helpers.ts#withJobLifecycle`) — so it gets BullMQ's existing
attempts/backoff and the Scene Queue module's `"retrying"` status for free. Retries are now
triggered by *validated bad output* on AI-synchronous generation paths (character sheet,
background, scene image, thumbnail resolution; the browser-automation video path's duration) —
not just "the call happened to throw." A human-uploaded manual video hand-off is deliberately never
auto-retried on a quality check: that would silently discard someone's deliberate upload, so a
duration mismatch there becomes a UI warning instead, never a forced regeneration.

## 16. API tokens + Claude Code plugin (2026-08 addition)

Everything in §1-15 is reachable only through a browser session (NextAuth cookie via `requireUserId()`
→ `auth()`). A Claude Code plugin driving this app's API from outside a browser needs a different
credential — `modules/api-tokens/` (`ApiToken` model: `{userId, name, tokenHash, tokenPrefix}`, only
the SHA-256 hash persisted, raw token shown once at creation, Settings page UI) is that credential.
`core/auth/session.ts#requireUserId()` now checks `headers().get("authorization")` for a
`Bearer <token>` first, falling back to the session cookie — a change to one function, not to any of
the 60+ route handlers that call it, since `headers()` reads the current request without needing one
passed in. A present-but-invalid Bearer header fails closed rather than silently falling back to an
unrelated session cookie on the same request.

`plugin/` is a self-contained Claude Code plugin (own `.claude-plugin/plugin.json`, `.mcp.json`, and
`skills/`) that authenticates with one of these tokens and drives the PDF pipeline end to end —
story → characters → backgrounds → scene images → video → voice → render → thumbnail — as one Skill
per step plus a `run-pipeline` orchestrator, entirely through this app's existing REST API. It never
calls Gemini/Veo/any vendor directly; see `plugin/README.md` for setup and the full tool list.

## 17. Module 7B — the first real browser-automation ProviderAdapter (2026-08 addition)

Module 7A (§13, "Browser Automation Engine") shipped a provider-agnostic framework with
`browserProviderRegistry` deliberately empty — no adapter, so every `browser_task` job failed
immediately and honestly with "No provider registered". Module 7B fills that in:
`src/core/browser-automation-providers/google-flow/` (`adapter.ts`'s `GoogleFlowProviderAdapter`,
`build-task.ts`, `register.ts`, registered once at `worker.ts` startup) drives labs.google/flow
through the framework's generic `ActionEngine`/`TaskStep` vocabulary instead of Module 4's hardcoded
step sequence — reusing Module 4's `FLOW_SELECTORS`/`FLOW_TIMEOUTS_MS` rather than duplicating a
second guess at them, same "unverified against the live product, recalibrate one file" caveat.

**Deliberately does not replace Module 4.** `scene_video_auto` (Module 4) is a complete,
already-working Scene-to-Cloudinary pipeline; Module 7B is the generic entry point
(`POST /api/browser-automation/tasks` with `providerId: "google-flow"`, or the plugin's
`run_google_flow_browser_task` tool) for ad hoc Flow automation with no Scene attached. Both paths
now exist side by side, per the choice the 7A plan doc explicitly left open ("possibly on top of
this framework, possibly replacing Module 4's ad-hoc version — a decision left to that module").

**One small, justified extension to the 7A framework itself**: `ProviderAdapter.executeAction`
originally returned `Promise<void>`, so `TaskEngine.run()`'s download/screenshot bookkeeping could
only ever push a placeholder path (`download-${step.id}`) — `ActionEngine.downloadFile`/
`captureScreenshot` already returned the real path, it just had nowhere to go. `executeAction` now
returns `Promise<Record<string, unknown> | void>`, threaded through `ActionPipelineResult.output` to
`TaskEngine.run()`, so a real provider can report `{ downloadPath }`/`{ screenshotPath }`. Backward
compatible (broadens a return type on an interface 7A shipped with zero implementations, so nothing
existing could depend on the old placeholder behavior) and confirmed via `next build` that none of
`core/browser-automation-providers/*` reaches any route's server bundle — same isolation check every
prior automation module has run.

**Character consistency is a structural heuristic, not an ML claim.** `core/quality/perceptual-hash.ts`
computes a difference-hash (dHash) via `sharp` — a dependency the prior codebase audit flagged as
declared-but-unused, now genuinely wired up — and compares a character's generated poses to its own
front-view pose, both from the same generation batch (comparable compositions, unlike comparing a
character portrait to an unrelated full scene shot). Below-threshold similarity is recorded as a
warning only, surfaced via a shared `QualityWarnings` component wherever a producer is already
looking (Character Library, Scene Manager) — never a retry trigger, the same "advisory, not
automated judgment" posture this codebase already takes toward anything it can't verify with
certainty (see §13's selectors caveat for the same spirit).
