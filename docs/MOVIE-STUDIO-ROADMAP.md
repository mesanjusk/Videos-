# AI Movie Studio — Audit & Migration Roadmap (2026-08-05)

Scope: assess the existing AI Video Studio against the "AI Movie Studio" vision (permanent
characters, unlimited-video production, browser automation into Google Flow) and produce a
KEEP/REFACTOR/REMOVE/NEW plan. **This is a continuation of prior work, not a rebuild.** The
project already implements a large fraction of the target architecture correctly — see
`ARCHITECTURE.md`, `docs/AUDIT.md`, `docs/database-schema.md` for the ground truth this builds on.

## 0. Headline finding

This is not a greenfield Next.js app. It is a working, deployed, end-to-end AI video pipeline:
Next.js 15 App Router, MongoDB/Mongoose, BullMQ+Redis queue, Cloudinary storage, a real
provider-abstraction layer (`core/ai`), a real template-driven prompt engine (`core/prompt-engine`),
and an FFmpeg render pipeline — all auth-scoped, all persisted, all surviving refresh. Roughly
**70% of the requested target architecture already exists and works.** The gap is concentrated in
three places:

1. **Character Library is reuse-by-duplication, not a true permanent library.** Characters still
   belong to exactly one project; "reuse" (`/library` page) copies the document into a second
   project. Two copies of "Tom" now drift independently — editing the original never propagates.
   This is the single biggest gap versus "permanent character database... every future project
   must reuse existing characters instead of recreating them."
2. **Browser Automation Engine does not exist at all.** No Playwright/Puppeteer dependency, no
   automation module. Google Flow is currently a **manual hand-off**: the app generates the prompt
   text, a human copies it into Flow, generates the clip by hand, and uploads the result back via a
   signed Cloudinary widget. This was a deliberate, documented decision (no public Flow API exists),
   not an oversight — but it means the entire bottom half of the requested pipeline (Browser
   Automation Engine → Google Flow → autonomous download/continue/retry) is genuinely new work.
3. **Quality Verification and a visible Queue dashboard don't exist as dedicated surfaces.**
   Job retry today is BullMQ's blind attempt-count backoff (3 attempts, exponential), not
   validation-triggered (character consistency, resolution, duration). There's no page that shows
   the production queue across all projects — job status is only visible per-project.

Everything else the target architecture asks for — Project Manager, Story Engine, Scene Engine,
Prompt Engine, Asset storage, provider abstraction, persistence-through-refresh — already exists
and is rated 6–8/10 in the prior audit. The plan below is written against that reality: extend and
refactor the strong foundation, don't replace it.

## 1. Module-by-module inventory: KEEP / REFACTOR / REMOVE / NEW

| Module | Verdict | Why |
|---|---|---|
| **Next.js/TS/Tailwind scaffold, auth (NextAuth v5), routing** | **KEEP** | Solid, no changes needed. `app/` stays thin (routes only), `modules/*/service.ts` stays the only DB access layer. |
| **`core/ai` provider abstraction** (Story/Image/Video/Voice interfaces + registry) | **KEEP** | Exactly the "never hardcode a provider" pattern requested. Adding a browser-automation-backed video provider later is one new file + one registry line — no refactor needed to support it. |
| **`core/prompt-engine`** (template files, `{{variable}}` substitution, per-scope defaults, Disney/Pixar/Anime/Realistic/3D/Custom styles) | **KEEP** | Matches "never hardcode prompts / support variables / support multiple styles" almost exactly. `PromptTemplate` is DB-stored per user, editable in `/prompts`, seeded from code defaults. |
| **`core/queue`** (BullMQ + Upstash, serverless poll-and-drain, `withJobLifecycle`, orchestrator for full-auto mode) | **KEEP**, extend | Waiting/running/completed/failed/cancelled all exist as real `Job.status` values today. "Retrying" is implicit (BullMQ `attempts`), not a surfaced state — addressed in Module 3, not a rebuild. |
| **Project (`modules/projects`)** | **KEEP**, light refactor | Already: story/characters/scenes/voice/assets/thumbnail/metadata/status/history, survives refresh (MongoDB-backed, no client-only state). `pipelineMode` (full/semi/manual) already exists. Module 2 adds a proper project-level activity/history view and a "reuse characters from Library" step in the wizard. |
| **Scene (`modules/scenes`)** | **KEEP** | Already exactly the requested shape: index/duration(via project)/environment(background)/characterIds/camera/emotion/action(visual)/dialogue/voice/Flow prompt(denormalized `pendingVideoPrompt`)/status/download URL/retry tracking via Job. No changes required by this roadmap. |
| **Character (`modules/characters`)** | **REFACTOR** (Module 1) | Core gap. `projectId` is required + part of a unique index, so a character cannot exist independent of one project. Reuse is clone-and-drift, not single-source-of-truth. Missing fields the brief asks for: `masterPrompt`, `animationStyle`, `colorPalette`, wired-up version history (`version`/`previousVersions` exist on the schema today but nothing ever writes to them), and a "previous videos" lookup. Expressions/poses (happy/sad/angry/walking-pose/running-pose) **already exist** in `CharacterPose` — just under-used (default generation only requests 3 of 10 poses) and not surfaced as a distinct "Expressions" UI section. |
| **Asset (`modules/assets`)** | **KEEP** | Cloudinary-backed, typed by kind, versioning fields reserved. Fine as the storage layer for characters/backgrounds/voice/video/thumbnails. A dedicated browsable "Asset Library" page is a UI gap noted in the prior audit (1/10) — folded into Module 2/6, not urgent versus Modules 1 and 4. |
| **Job (`modules/jobs`)** | **KEEP** | Already the right shape for a production queue. Module 3 adds a cross-project dashboard view; the model itself needs no schema change. |
| **Google Account Manager (`modules/accounts`)** | **KEEP** (one known bug) | Pooled-credential rotation for free-tier quota spreading — real, working, encrypted at rest. `docs/AUDIT.md` flags one unresolved item (no OAuth verification step) that's orthogonal to this roadmap; left as-is unless requested. |
| **FFmpeg render pipeline (`core/ffmpeg`)** | **KEEP** | Hand-verified `xfade`/`zoompan`/`acrossfade`/`subtitles` pipeline, runs only in the queue processor / `worker.ts`, never in a request handler. No changes needed. |
| **Google Flow "manual hand-off" video provider** | **KEEP as fallback, add automated path alongside it (Module 4)** | Don't delete the manual path — it's the correct fallback when automation fails, hits a CAPTCHA, or a user has no automatable browser environment. Browser Automation becomes a *second* `VideoProvider` implementation behind the same interface; manual hand-off stays available per-project as an explicit toggle. |
| **Browser Automation Engine** | **NEW MODULE** (Module 4) | Does not exist in any form — no Playwright/Puppeteer/Selenium dependency in `package.json`, no automation code anywhere in `src/`. This is the largest genuinely new piece of work in the whole roadmap. |
| **Quality Verification** | **NEW MODULE** (Module 5) | No character-consistency scoring, resolution/duration validation, or missing-asset check exists today. Retry exists only as BullMQ's blind attempt counter. |
| **Queue dashboard (UI)** | **NEW** (part of Module 3) | Job status is real and polled per-project (`useJobPolling`); there is no `/queue` page aggregating it across projects the way the requested architecture's "Scene Queue" box implies. |
| **Analytics (UI)** | **NEW**, low priority | Not part of the explicit module order the user gave (Character Library → Project Manager → Scene Queue → Browser Automation → Quality Checker); deferred to a later pass. |
| **Publishing/export** | **NEW**, low priority | Already flagged missing in `docs/AUDIT.md` (`targetPlatform` collected, never used). Deferred — no automation-adjacent dependency, can land any time after Module 4. |
| **`fluent-ffmpeg`/`sharp` dependency cleanup** | **REMOVE or wire up** | Pre-existing debt noted in `docs/AUDIT.md`, unrelated to this roadmap; not touched unless it blocks a module above. |

Nothing in the current codebase is categorized **REMOVE** outright — every existing module is either
directly reusable or needs targeted refactoring, not replacement. This matches the "never remove
working code unless absolutely necessary" constraint.

## 2. Target pipeline mapped onto what exists today

```
Dashboard                    KEEP  — (dashboard)/dashboard, real DB-backed stats widgets
  ↓
Project Manager              KEEP + refactor (Module 2) — modules/projects, already persists
  ↓                           through refresh; add cross-module activity/history view
Story Engine                 KEEP — Gemini StoryProvider → structured StoryJson → auto-creates Scenes
  ↓
Character Library            REFACTOR (Module 1) — decouple from single-project ownership,
  ↓                           add masterPrompt/animationStyle/colorPalette/version history/videos
Prompt Engine                KEEP — core/prompt-engine, template-driven, style-aware, editable in /prompts
  ↓
Scene Queue                  KEEP core + NEW dashboard (Module 3) — Job/BullMQ already production-
  ↓                           grade; add the missing cross-project Waiting/Running/.../Cancelled view
Browser Automation Engine    NEW (Module 4) — Playwright-driven VideoProvider implementation
  ↓                           behind the existing core/ai interface; runs in worker.ts, not Vercel
  ↓                           serverless (same constraint FFmpeg render already lives under)
Google Flow                  KEEP manual hand-off as fallback; automation drives the same UI
  ↓
Quality Verification         NEW (Module 5) — character-consistency/resolution/duration checks
  ↓
Auto Retry                   REFACTOR (Module 5) — from blind attempt-count to validation-triggered
  ↓
Video Library                KEEP — Asset(kind: final_video) + dashboard gallery already exist
  ↓
Publishing                   NEW, deferred — not in the user's explicit module order
```

## 3. The one architectural decision this roadmap is making now, flagged explicitly

**Browser automation cannot run inside a Vercel serverless function.** A Playwright-controlled
Chromium session needs to stay alive for minutes (navigate Flow, upload references, submit a
prompt, poll for render completion, download the result) — serverless functions are request-scoped
and time-boxed. The render pipeline already hit this exact wall with FFmpeg and the documented
answer was `worker.ts`, a standalone long-lived process. Module 4 reuses that same pattern: the
automation engine runs as a queue processor inside `worker.ts` (self-hosted/always-on), not as a
Vercel API route. Vercel stays the app/API/dashboard host; a small always-on worker (Railway/Fly/a
VPS/etc. — infra choice deferred to when Module 4 starts) becomes the automation runtime, matching
what `ARCHITECTURE.md` §7 already calls out as the "self-hosting/always-on fallback" for exactly this
class of problem.

Also flagged, not decided here: automating a Google product's web UI (no public API) means the
automation must behave like a careful, low-volume human operator — one job at a time per pooled
account, real waits for page state rather than fixed sleeps, and an explicit circuit breaker that
falls back to the existing manual hand-off the moment Flow's UI changes shape or presents a
verification challenge. Module 4's design doc (produced when that module starts) will spell out
these guardrails before any automation code ships.

## 4. Delivery order (matches the user's explicit sequence)

1. **Character Library** — schema refactor + service + API + new global `/characters` page,
   replacing duplication-based reuse with true single-source-of-truth reuse. *(this session)*
2. **Project Manager** — after Module 1 is confirmed.
3. **Scene Queue** — cross-project dashboard, surfaced retry state.
4. **Browser Automation Engine** — Playwright `VideoProvider`, `worker.ts`-hosted, manual hand-off
   kept as fallback.
5. **Quality Verification + Auto Retry** — validation-triggered retry replacing blind attempt-count
   retry.

Each module ships as its own reviewable commit, and work pauses for confirmation after Module 1
before Module 2 starts, per the requested workflow.

## 5. Status

- [x] **Module 1 — Character Library.** `Character.projectId` is now optional (a "home" project,
      set on first use); `usedInProjectIds[]` tracks every other project a character is reused in.
      `assignCharacterToProject` replaces the old clone-and-duplicate flow — the same document
      becomes usable in another project, not a copy that drifts. Added `masterPrompt`,
      `animationStyle`, `colorPalette`, and wired up the previously-dead `version`/`previousVersions`
      fields (`updateCharacter` snapshots before every creative-field edit). New global `/characters`
      page (Character Library) with create/edit/assign/delete and a "previous videos" lookup across
      every project the character has appeared in; `/library` narrowed to backgrounds only, which the
      Character Library now supersedes for characters. Default character-sheet generation expanded
      from 3 to 6 poses (front-view + happy/sad/angry/walking/running) to match the requested
      Expressions set out of the box. Fixed two call sites (`thumbnail.processor.ts`,
      `orchestrator.ts`) that only looked up a project's *own* characters and would otherwise have
      silently excluded reused ones from thumbnails and full-auto mode.
      TODO/known boundary: a character with no home project yet can't generate or upload a reference
      image until it's assigned to at least one project (Job/Asset still require a `projectId` —
      loosening that is Asset/Job-model work, out of scope here; flagged for a future pass if wanted).
- [ ] Module 2 — Project Manager. Pending confirmation on Module 1.
- [ ] Module 3 — Scene Queue.
- [ ] Module 4 — Browser Automation Engine.
- [ ] Module 5 — Quality Verification + Auto Retry.
