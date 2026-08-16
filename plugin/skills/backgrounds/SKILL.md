---
description: Create a project's backgrounds (PDF Step 3) via Gemini image generation. Use once a project's story exists, alongside characters.
---

Create backgrounds for project: $ARGUMENTS

1. From the story's scene list, identify the distinct locations needed and call `create_background`
   for each with a `name`, `description` (no characters, matching the project's art style), and
   `lighting` (defaults to "morning" per the PDF's example).
2. Report each background's id once its generation job completes.
3. Once at least one character and one background exist, every scene can be assigned via
   `update_scene` and moved through `/ai-video-studio:scene-images` and
   `/ai-video-studio:video` — or flip the project to `pipelineMode: "full"` with
   `set_pipeline_mode` and let the app auto-chain the rest.
