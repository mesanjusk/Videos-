# AI Video Studio — Codebase Audit (2026-08-04)

Scope: verify `ARCHITECTURE.md`'s claims against the actual code, rate each area 1–10, and
produce a prioritized punch list. This is a continuation of existing work, not a rebuild —
most of the approved stack is already wired up correctly. The gaps are concentrated in three
places: (1) a few real correctness bugs, (2) UI affordances that exist in the data model but
were never rendered, and (3) entire product surfaces from the V2 vision that don't exist yet
(cross-project reuse, lip-sync, export).

## Ratings by area

| # | Area | Rating | Verdict |
|---|---|---|---|
| 1 | Data model (Mongoose schemas) | 8/10 | Keep |
| 2 | AI provider abstraction (`core/ai`) | 8/10 | Keep |
| 3 | Google Account Manager | 6/10 | Refactor |
| 4 | Queue system (BullMQ on Vercel) | 8/10 | Keep |
| 5 | Prompt engine | 4/10 | Refactor |
| 6 | Scene editor UI | 5/10 | Refactor |
| 7 | Project wizard | 5/10 | Missing/build new (partial) |
| 8 | Character memory across episodes | 1/10 | Missing/build new |
| 9 | Asset Library | 1/10 | Missing/build new |
| 10 | Dashboard | 6/10 | Refactor |
| 11 | UI/UX polish (empty states, skeletons, help) | 7/10 | Keep |
| 12 | Auth & security | 7/10 | Keep (one real gap) |
| 13 | Code quality / duplication | 6/10 | Refactor |
| 14 | Fix quality in git history | 7/10 | Keep |

## What's already good (keep as-is)

- **Provider abstraction is real, not aspirational.** `@google/genai` is imported *only* inside
  `src/core/ai/providers/google/*`. No module or route touches a vendor SDK directly. Adding a
  second provider is a registry line + one file, per the original design.
- **Job lifecycle is genuinely end-to-end.** `queued → running → completed/failed/cancelled`,
  plus `manual_pending` for the Google Flow hand-off, all flow through one
  `withJobLifecycle` helper used by all 7 processors. The serverless queue tick evolved from a
  fragile HTTP self-call into an in-process `after()` call — a real fix, not a workaround.
- **Encryption is done correctly.** AES-256-GCM, random IV per encryption, auth tag verified,
  decrypted only inside `modules/accounts/*`, never sent to the client (`credentials` field is
  explicitly stripped from every API response).
- **Auth scoping is consistent.** All 28 API routes were checked; every one (other than
  NextAuth's own handler and the `CRON_SECRET`-gated queue tick) requires a session and scopes
  every DB query by `{_id, userId}` together. No IDOR found.
- **Git history shows real root-causing, not band-aids** — e.g. the quota lockout fix
  (`3c72386`) replaced a blanket 24h cooldown with a documented 60s one and explained why in a
  code comment, rather than just changing the number.

## Real bugs found

1. **Google account selection race condition** (`src/modules/accounts/selector.ts:26-39`) — the
   selector does a `findOne` then a separate `.save()` to bump `lastUsedAt`. Two concurrent
   queue ticks can select and dispatch against the same least-recently-used account
   simultaneously, defeating the pooling's whole purpose. Needs an atomic `findOneAndUpdate`.
2. **Prompt engine's dependency-based invalidation is dead code.** `dependentScopes()` in
   `core/prompt-engine/engine.ts` has zero callers. Editing a scene's `camera`/`emotion`/etc. via
   `PATCH /api/scenes/[id]` does a raw `$set` with no downstream invalidation at all — contradicts
   §5 of the architecture doc directly. Compounding this, the scene-image template declares a
   variable (`cameraAngle`) that doesn't match the actual `Scene` field name (`camera`), so the
   dependency graph couldn't match correctly even if wired up.
3. **Google Account Manager's OAuth step doesn't exist.** The architecture mandates OAuth
   consent (to prove which Google account this is) followed by pasting a Gemini API key.
   The actual `AddAccountForm` just lets the user type an arbitrary email/displayName with no
   verification at all.

## UI/UX gaps (data exists, was never rendered)

- Account cards model `quota.used`/`quota.dailyLimit`/`lastUsedAt` but never render them —
  quota is invisible to the user despite being the single most important piece of information
  for managing a multi-account pool.
- Dashboard's "Recent videos" is a bare count; `listRecentFinalVideos()` already exists in
  `modules/assets/service.ts` but the dashboard page never calls it — no actual video gallery.
- `JobBadge` (the shared status-chip component) is used in exactly one place
  (`recent-activity.tsx`); `scenes-manager.tsx` and `edit-panel.tsx` both reimplement status
  text/spinners ad hoc instead of reusing it.

## Missing entirely (net-new build required)

- **Cross-project character/background reuse ("episode memory").** `Character`/`Background` are
  hard-scoped to one `projectId`, which is part of their unique index — there is no way,
  structurally, to reuse a character in a second project. `videoType: "series-episode"` exists
  as a decorative wizard option with no supporting schema or behavior.
- **Asset/Media Library.** No page, no reusable-library service beyond the Prompt Library
  (which genuinely works). Backgrounds, characters, voices, watermarks are all project-scoped
  with no browse/reuse surface.
- **Lip-sync step.** No provider, no model field, no UI, no mention anywhere in the codebase.
  No approved provider (Gemini/Flow) does lip-sync directly, so this needs either a manual
  hand-off step (same pattern as Google Flow video) or an explicit "skipped" state, documented
  the same way the Music step's provider gap is already documented.
- **Export/upload step.** `targetPlatform` is collected at project creation and never used
  again; the render/edit page only offers a raw file download, no YouTube/Instagram/TikTok
  upload integration.
- Drag-and-drop scene reordering and inline editing of `camera`/`emotion`/`dialogue`/`visual`
  text — the update schema supports these fields, but no UI reaches them.

## Code quality debt

- The `try { requireUserId() } catch UnauthorizedError → 401, catch → 500` block is copy-pasted
  near-verbatim across ~24 route handlers. A shared `withApiAuth(handler)` wrapper would remove
  most of this duplication risk-free.
- `fluent-ffmpeg` and `sharp` are both declared dependencies that are entirely unused in source
  (compose.ts calls `execFile` directly; no Sharp import exists anywhere) — the "Image ops:
  Sharp" architecture line is aspirational only.

## Delivery plan for this session

Given the size of the full V2 vision, work proceeds in milestones, each committed separately:

1. **Correctness/security fixes + quick UX wins** — the account-selector race, quota
   rendering, dashboard video gallery, `JobBadge` consistency, prompt-engine variable/dependency
   fix. Low risk, immediately visible value.
2. **Asset Library + cross-project character/background reuse** — the biggest gap versus the
   product vision (rated 1/10), and the one most responsible for the app feeling like a
   collection of disconnected project pages rather than a studio with memory.
3. **Scene editor upgrades** — drag-and-drop reorder, inline field editing, wired to the fixed
   dependency-invalidation from milestone 1.

Lip-sync and platform export are deliberately not in this session's scope — they require a
product decision (manual hand-off vs. skip, which platforms/OAuth scopes to support) that's
flagged here for a follow-up milestone rather than guessed at.
