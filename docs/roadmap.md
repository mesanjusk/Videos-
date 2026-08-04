# Delivery Roadmap

Mirrors `ARCHITECTURE.md` §11. Each stage lands as its own commit on
`claude/video-studio-architecture-wruz2h` so the build is reviewable incrementally rather than as one
large diff.

- [x] **Stage 1 — Foundation.** Next.js 15/TS/Tailwind scaffold. `core/ai` provider abstraction
      (Story/Image/Video/Voice interfaces + registry). Gemini providers for story/image/voice. Google
      Flow video provider modeled as a manual hand-off (no public API exists). `core/prompt-engine`
      with the PDF's default templates. `core/db` Mongoose models: Project, Character, Background,
      Scene, Job, Asset, PromptTemplate, Settings. `modules/accounts` — the Google Account Manager,
      with AES-256-GCM credential encryption and a quota-aware round-robin selector.
- [x] **Stage 2 — Auth + dashboard shell + wizard.** NextAuth v5 Google OAuth (JWT session strategy,
      split edge-safe `auth.config.ts` from the Node-only `auth.ts` so `middleware.ts` never pulls in
      the MongoDB driver). Sidebar/topbar dashboard layout, dark/light theme (next-themes). Stats
      widgets wired to real DB queries (projects, recent videos, current jobs, storage, Google
      accounts, queue, recent activity) with empty states, not placeholder numbers. 4-step project
      creation wizard (Basics → Style → Story → Generate) with React Hook Form + Zod + Framer Motion
      step transitions. Google Account Manager UI (add/enable/disable/set-default/remove, paired with
      the ARCHITECTURE.md §3 two-step "OAuth-confirm-identity + paste AI Studio API key" flow).
      shadcn-style UI primitives hand-written against Radix (button, card, dialog, dropdown-menu,
      select, tabs, tooltip, etc.).
- [ ] **Stage 3 — Story/Character/Background generation.** BullMQ queues + the Vercel cron-tick worker
      runtime. Story/character/background API routes wired to the providers through the queue.
      Character Library and Background Library UI (create once, reuse forever; version history).
- [ ] **Stage 4 — Scene Manager + scene image/video.** Scene cards (image, dialogue, camera, voice,
      emotion, status; generate/regenerate/duplicate/delete). Scene image generation. The Google Flow
      manual hand-off UI: assembled prompt + character reference shown to the operator, signed
      Cloudinary upload widget to complete the task.
- [ ] **Stage 5 — Voice + render + thumbnail.** Gemini voice provider wired through the queue. FFmpeg
      compose processor: concat clips in scene order, mix voice + music, burn captions, apply
      zoom/transition presets, overlay logo/watermark, export 1080×1920 30fps H.264. Thumbnail
      generator (image + auto title/description/tags).
- [ ] **Stage 6 — Prompt Library, Settings, polish.** Editable prompt templates UI (variables,
      dependency-aware regeneration). Settings (theme, language, provider overrides, Cloudinary/Mongo
      status). Empty states, loading skeletons, Framer Motion transitions, responsive pass. API
      reference and deployment guide docs.
