# API Reference

All routes live under `src/app/api`, require a signed-in session (`requireUserId()` —
`401 { error: "Unauthorized" }` otherwise), and are scoped to that user; there is no cross-user
access path. Every route is `export const dynamic = "force-dynamic"` — none are statically rendered
(ARCHITECTURE.md §6). Routes that enqueue work return `202` with the created `Job`; poll
`GET /api/jobs/:id` for status.

## Auth

- `GET|POST /api/auth/[...nextauth]` — NextAuth (Google OAuth, JWT session).

## Projects

- `GET /api/projects` / `POST /api/projects` — list / create (the wizard's final step).
- `GET /api/projects/:id` / `PATCH /api/projects/:id` / `DELETE /api/projects/:id` — `PATCH` currently
  accepts `{ watermarkImageUrl: string | null }`.
- `POST /api/projects/:id/story` → enqueues a `story` job. Also auto-creates the project's `Scene`
  documents once it completes.
- `GET /api/projects/:id/characters` / `POST /api/projects/:id/characters` — create enqueues a
  `character_image` job.
- `GET /api/projects/:id/backgrounds` / `POST /api/projects/:id/backgrounds` — create enqueues a
  `background_image` job.
- `GET /api/projects/:id/scenes` — list, populated with character/background/asset references.
- `POST /api/projects/:id/render` → enqueues a `render` job (the FFmpeg compose pipeline).
- `POST /api/projects/:id/thumbnail` → enqueues a `thumbnail` job.
- `GET /api/projects/:id/music/upload-params` → signed Cloudinary upload params (browser uploads
  directly, no file passes through the Next.js server).
- `POST /api/projects/:id/music/upload` → records an already-uploaded music file as the project's
  background track (`{ url, publicId, durationSeconds?, bytes? }`).

## Characters

- `DELETE /api/characters/:id`.
- `POST /api/characters/:id/sheet` → enqueues a `character_image` job (first generation or
  "Regenerate").

## Backgrounds

- `POST /api/backgrounds/:id` → enqueues a `background_image` job ("Regenerate").
- `DELETE /api/backgrounds/:id`.

## Scenes

- `PATCH /api/scenes/:id` — `{ characterIds?, backgroundId?, camera?, emotion?, dialogue? }`.
- `DELETE /api/scenes/:id`.
- `POST /api/scenes/:id/duplicate` — copies the scene at the next index, clearing generated assets.
- `POST /api/scenes/:id/image` → enqueues a `scene_image` job.
- `POST /api/scenes/:id/video` → enqueues a `scene_video` job. With the only registered `VideoProvider`
  (Google Flow) this always resolves to `manual_pending` — see below.
- `GET /api/scenes/:id/video/upload-params` → signed Cloudinary upload params for the manual clip.
- `POST /api/scenes/:id/video/upload` — `{ taskId, url, publicId, durationSeconds, bytes? }`. Completes
  the manual hand-off: records the clip as an `Asset`, flips the scene to `video_ready`, and marks the
  `manual_pending` `Job` completed. `taskId` must match the scene's current `videoTaskId` (409 otherwise).
- `POST /api/scenes/:id/voice` → enqueues a `voice` job (400 if the scene has no dialogue).

## Jobs

- `GET /api/jobs/:id` — poll target for every async operation above.

## Queue

- `POST|GET /api/queue/tick` — bearer-secret protected (`CRON_SECRET`), runs the bounded-time BullMQ
  worker (ARCHITECTURE.md §7). `POST` is the fire-and-forget self-call after enqueue; `GET` is what
  Vercel Cron invokes. Not meant to be called manually.

## Google Account Manager

- `GET /api/accounts` / `POST /api/accounts` — list / add a pooled account
  (`{ email, displayName, apiKey }`).
- `PATCH /api/accounts/:id` — `{ action: "enable" | "disable" | "set-default" }`.
- `DELETE /api/accounts/:id`.

## Prompt Library

- `GET /api/prompt-templates` — every scope, seeding any missing ones for this user first.
- `PATCH /api/prompt-templates/:id` — `{ template: string }`.
- `POST /api/prompt-templates/:id/reset` — restores the code-level default text for that scope.

## Settings

- `GET /api/settings` — creates the user's `Settings` doc on first access if missing.
- `PATCH /api/settings` — either `{ capability: "story"|"image"|"video"|"voice", providerId }` or
  `{ defaultLanguage }`.
