---
description: Create a project's characters and their Pixar-style turnaround sheets (PDF Step 2) via Gemini image generation. Use once a project's story exists.
---

Create characters for project: $ARGUMENTS (a project id, plus however many characters the story calls for)

1. `generate_story`'s output (or `list_scenes`) tells you how many main characters the script needs
   and roughly who they are. For each one, call `create_character` with the PDF's turnaround-sheet
   spec fields (age, bodyType, face, eyes, hair, clothes, shoes, accessories, personality) — infer
   sensible values from the story/dialogue if the user hasn't specified them, but ask if the story
   gives you nothing to go on for a character central to the plot.
2. Each call generates the full pose sheet server-side (front/side/back/45 degree views x happy/sad/
   angry/laughing expressions x walking/running poses, white background, 1080x1350) — report each
   character's id once its job completes.
3. Once every character exists, move on to `/ai-video-studio:backgrounds`, then assign characters to
   scenes with `update_scene` before generating scene images/video.
