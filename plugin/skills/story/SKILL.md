---
description: Generate the 8-scene cartoon script for a project (PDF Step 1) via Gemini. Use after a project exists and needs its story written.
---

Generate the story for project: $ARGUMENTS (a project id — ask for one or run `list_projects` if not given)

1. Call `generate_story` with that `projectId`.
2. It waits for the job internally; report the resulting scenes (or the job's error if it failed —
   most commonly an expired/missing Gemini API key on the account, which the user fixes at
   `/accounts` in the app, not something this plugin can retry around).
3. Once scenes exist, the natural next steps are `/ai-video-studio:characters` and
   `/ai-video-studio:backgrounds` — both need to exist before any scene image/video can be built.
