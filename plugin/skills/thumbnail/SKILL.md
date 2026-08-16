---
description: Generate a YouTube-style thumbnail (PDF Step 10) via Gemini image. Use once the final video is rendered (or in parallel — it doesn't depend on the render).
---

Generate a thumbnail for project: $ARGUMENTS

1. Call `generate_thumbnail`. This follows the PDF's exact thumbnail prompt (large expressive
   characters, bright colors, minimal background, large title space) automatically.
2. Report the thumbnail asset once ready. Uploading to YouTube (PDF's final "Upload" step) isn't
   wired into this plugin yet — the app's own YouTube Data API integration needs a verified OAuth
   consent screen configured outside this codebase first (see ARCHITECTURE.md §12's "not done" list).
   Until then, tell the user to download the rendered video + thumbnail from the app and upload
   manually.
