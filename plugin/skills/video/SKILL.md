---
description: Generate scene video clips (PDF Step 5, Google Flow/Veo). Use once a scene has its image ready. This is the step with no public Google API — it either drives Flow's browser UI like a human, or hands you the exact prompt to paste in yourself.
---

Generate scene video for project: $ARGUMENTS

Google Flow (labs.google/flow) is the only approved video tool and it has **no public developer
API** — Veo is only reachable through Flow's own web app. So this step always does one of two things:

1. **Prefer automated ("acts like a human")**: call `list_google_accounts` — if any account has a
   connected Flow browser session, call `generate_scene_video_auto` for each scene. Under the hood
   Playwright opens Flow, uploads the character reference, pastes the Step-5 prompt (reference +
   action + camera + lighting + emotion + duration + style), clicks generate, waits for the 5-8s
   render, downloads it, and files it into the scene — no human step. It needs the app's standalone
   worker process running (`npm run worker`); if the job just sits `queued`, tell the user to start
   it.
2. **Manual fallback**: if no Flow session is connected, or `generate_scene_video_auto`'s job comes
   back `manual_pending` (Flow presented a CAPTCHA, the session expired, or its UI changed — this
   circuit-breaks rather than retrying blindly), call `generate_scene_video` instead. Show the user
   the returned prompt text and tell them: paste it into labs.google/flow with the attached character
   reference, generate a 5-8 second clip, download it, and upload it back through the app's Scene
   Manager (there's no way for this plugin to complete that hand-off itself — the upload widget needs
   a browser).

Never invent a third path (no other Google video-generation product exists in this stack) and never
poll `generate_scene_video_auto` past its own timeout hoping it finishes — report what actually
happened and let the user decide whether to wait longer or fall back to manual.
