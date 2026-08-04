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
| Video compose | FFmpeg (`fluent-ffmpeg` + `@ffmpeg-installer/ffmpeg`) | runs only inside queue processors, never in a request handler |
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
  1. **Vercel Cron** (`vercel.json`, every minute) — the steady heartbeat.
  2. **Fire-and-forget self-call** immediately after a route enqueues a job — cuts p50 latency from
     ~30s (cron cadence) to near-immediate, cron remains the reliability backstop.
- Inside the tick handler: construct a `Worker` per queue with `autorun: false`, call `worker.run()`,
  and `worker.close()` after a fixed time budget (`QUEUE_TICK_BUDGET_MS`, default 45s, safely under
  Vercel's function timeout) or when no jobs remain, whichever is first. This is the standard
  "poll-and-drain" pattern for running BullMQ on serverless.
- Processors live in `src/core/queue/processors/*`, each a pure function `(job) => Promise<result>`
  that calls the resolved AI provider (§2/§3), uploads results to Cloudinary (§storage), and updates
  the owning `Scene`/`Project`/`Job` documents.
- If self-hosting/always-on hosting is available later, `worker.ts` at the repo root runs the same
  processors as a true long-lived Worker — the processor functions are host-agnostic by design.

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

`core/ffmpeg/compose.ts`: download scene clips + voice track + music track from Cloudinary into
`/tmp` (ephemeral, cleaned per invocation) → concat clips in scene order → mix voice + music →
burn captions (from `Scene.dialogue`) → apply configured zoom/transition preset → overlay
logo/watermark if configured → export `1080×1920, 30fps, H.264` → upload the result to Cloudinary as
an `Asset(kind: "final_video")` → mark `Project.status = "done"`. Runs exclusively inside the
`render` queue processor (never in a request handler) because it is CPU- and time-heavy.

## 10. Folder structure

```
src/
  app/                      routes only — thin handlers, no business logic
    (marketing)/            landing page
    (auth)/login/
    (dashboard)/            authenticated shell: dashboard, projects, accounts, settings
    api/                    route handlers per §6
  modules/                  feature-based domain modules (model + service per feature)
    accounts/ projects/ characters/ backgrounds/ scenes/ jobs/ assets/ prompt-templates/
  core/                     cross-cutting, host-agnostic
    ai/                     provider interfaces + registry + vendor implementations (§2)
    prompt-engine/          §8
    queue/                  connection, queue defs, tick runtime, processors (§7)
    ffmpeg/                 §9
    storage/                cloudinary.ts (upload, signed-upload params, delete)
    db/                     mongoose.ts (cached connection), mongo-client.ts (native, NextAuth adapter)
    auth/                   NextAuth config, session helpers, encryption util for §3
  components/
    ui/                     shadcn primitives
    shared/                 Stepper, EmptyState, LoadingSkeleton, HelpButton, ProgressBar, JobBadge
    layout/                 Sidebar, Topbar, ThemeToggle, CommandPalette
  hooks/                    useProject, useJobPolling, useProviderSettings, ...
  lib/                      utils.ts (cn, formatters), constants.ts
  types/                    shared TS types not owned by a module
worker.ts                   optional standalone worker (self-hosted fallback, §7)
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
