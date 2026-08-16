---
description: Compose all scene clips, narration, and optional music into the final video (PDF Step 9) via the app's own FFmpeg pipeline. Use once every scene has a video and (where applicable) voice.
---

Render the final video for project: $ARGUMENTS

1. Call `list_scenes` and confirm every scene is at least `video_ready` (voice/lip sync are optional
   — the render mixes in silence for scenes without narration). If several scenes still need video,
   point the user back to `/ai-video-studio:video` first rather than rendering an incomplete cut.
2. Call `render_project`. This runs entirely inside the app (scale/crop to portrait, Ken Burns zoom,
   crossfade transitions, caption burn-in, optional music bed, 1080x1920 30fps H.264) — no external
   editor (CapCut/Premiere/DaVinci from the PDF) is used or needed.
3. Report the final video asset once the job completes, and mention `/ai-video-studio:thumbnail` as
   the last step before upload.
