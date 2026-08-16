---
description: Generate every scene's still frame (PDF Step 4 formula) via Gemini image. Use once a project has characters, backgrounds, and scenes assigned.
---

Generate scene images for project: $ARGUMENTS

1. Call `list_scenes` for the project. For any scene missing a `characterIds`/`backgroundId`
   assignment, ask the user which character(s)/background it needs, then call `update_scene`.
2. For each scene, call `generate_scene_image`. This applies the PDF's Step-4 formula server-side
   (character reference + background + action + camera + emotion + lighting + style, plus the
   Character Consistency Formula appended automatically) — you only choose which scenes to run.
3. Report which scenes are `image_ready` vs which failed, and why (usually a Gemini quota/account
   issue, visible in the job's `error` field — the fix is adding another Google account at
   `/accounts` in the app, not retrying blindly).
