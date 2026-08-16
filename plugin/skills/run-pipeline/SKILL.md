---
description: Run the whole PDF cartoon workflow end to end from a single idea, using only Google tools. Use when the user wants a finished video without stepping through each stage themselves.
---

Run the full pipeline for: "$ARGUMENTS"

This chains every other skill in this plugin in order. Do each step for real (call the tools —
don't just describe what you'd do), and stop to ask the user only where the pipeline itself can't
proceed without a human:

1. `/ai-video-studio:new-project` — create the project from the idea.
2. `/ai-video-studio:story` — generate the script.
3. `/ai-video-studio:characters` — one call per main character the story introduces.
4. `/ai-video-studio:backgrounds` — one call per distinct location.
5. Assign each scene's `characterIds`/`backgroundId` via `update_scene` (infer the obvious mapping
   from each scene's `visual` text; ask only if it's genuinely ambiguous).
6. Call `set_pipeline_mode` with `pipelineMode: "full"` — from here, the app itself auto-chains scene
   image -> video -> voice -> render -> thumbnail as each prerequisite becomes ready
   (`core/queue/orchestrator.ts`). You don't need to call `generate_scene_image`/`generate_voice`/
   `render_project`/`generate_thumbnail` yourself once this is set.
7. Video (PDF Step 5) is the one stage full-auto mode does NOT drive on its own — it still needs
   `/ai-video-studio:video` called explicitly per scene, since it's the step with no public API
   (browser automation or a manual hand-off, per that skill).
8. Poll `list_scenes` / `get_project` periodically (don't busy-loop — a few checks a couple of
   minutes apart is enough) and report progress. Once the project's status reaches "done", report the
   final video and thumbnail assets.

Lip sync and music (PDF Steps 7-8) have no Google-only tool available in this stack and are
deliberately left as manual steps in the app's UI — say so plainly rather than skipping past them
silently. Uploading to YouTube isn't wired in yet either (see the thumbnail skill) — hand the user
the final files instead of claiming the job is fully done if they asked for it published.
