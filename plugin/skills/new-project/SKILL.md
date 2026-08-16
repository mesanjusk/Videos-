---
description: Start a new AI cartoon video project from a topic or idea (PDF workflow setup). Use when the user wants to begin a new cartoon/animated short.
---

Create a new project for: "$ARGUMENTS"

1. Call `create_project` with a short `title` and a `premise` derived from the user's idea (1-2
   sentences — Gemini expands this into the full 8-scene script server-side, following the PDF's
   exact Step-1 prompt formula). Ask the user only for what you can't reasonably infer: target
   platform, style (Pixar/Anime/2D Cartoon/Claymation/Custom), and duration, defaulting to
   youtube/Pixar/60s if they don't care.
2. Report the created project's id and confirm the next step is `/ai-video-studio:story` (or just
   ask if they want the whole pipeline run automatically — see `/ai-video-studio:run-pipeline`).

Remember: every generation step behind these skills goes through Gemini (text/image/voice) or
Google Flow (video) — nothing else. If a tool call fails with "CARTOON_API_TOKEN is not set", tell
the user to open the app's Settings page, create an API token, and set it in this plugin's
environment before continuing.
