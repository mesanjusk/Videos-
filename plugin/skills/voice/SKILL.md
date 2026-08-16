---
description: Generate narration audio for scenes with dialogue (PDF Step 6) via Gemini TTS. Use once scenes have dialogue written.
---

Generate voice for project: $ARGUMENTS

1. Call `list_scenes`; for every scene with non-empty `dialogue`, call `generate_voice`.
2. Scenes with no dialogue are skipped by design (the API 400s on them) — don't treat that as a
   failure.
3. Report which scenes now have narration. Lip sync (PDF Step 7) and music (PDF Step 8) have no
   Google-only tool in this stack (Hedra/HeyGen/Kling and Suno/Udio/Epidemic/Artlist all aren't
   Google) — both stay manual steps in the app's own UI; don't attempt to fake them here.
