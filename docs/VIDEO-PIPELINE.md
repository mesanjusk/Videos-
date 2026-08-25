# Video pipeline

## The stages

```
prompt → research → fact-check → script → storyboard → characters → assets
       → images → video → voice → captions → timeline → render → quality
       → retry (targeted) → finalize
```

Which stages run is decided by the pipeline, which is data —
`src/core/production/pipelines.ts`. Six ship: `short_reel`, `wedding_reel`, `explainer`,
`documentary`, `invitation`, `product_video`. Adding a seventh is an entry in that array, not a new
branch in a growing function.

A user can skip stages; the pipeline honours it, and a skip for a stage the pipeline does not run
is recorded as a note rather than silently ignored.

## Two ways in

**Production Profile** (pre-existing) — a saved configuration plus a topic. `generateFromProfile`
creates the project and enqueues the story job.

**Production Director** (added by the merge) — one line of natural language. Produces a reviewable
plan; on approval it creates the project and enqueues the same story job.

Both converge on the same machinery. The Director does not reimplement the pipeline it plans —
every stage worker already carries its own provider routing, quality checks and retry behaviour,
and a planner that generated assets inline would bypass all of it.

## The auto-chain

`src/core/queue/orchestrator.ts` (pre-existing, unchanged) chains a project in `full` pipeline mode:
scene image → scene video → voice → lip-sync, each when its prerequisite exists, then render →
thumbnail once every scene is terminal.

It deliberately never invents a Character or Background from scratch, and never proceeds past a
manual hand-off on its own. The chain resumes automatically once a human supplies what was missing.

## Video generation, and the fallback

`VideoProvider` returns either a completed clip or `manual_pending` — a structural way to say "no
API exists for this, a person must run it".

When it returns `manual_pending` **and** browser fallback is enabled **and** a Flow browser session
is connected, the job diverts to `scene_video_auto` instead of parking. That path drives the site
through the shared browser engine and, if the site fails, degrades to the same manual hand-off — so
the worst case is exactly today's behaviour, one queue hop later.

Off by default: diverting a job that would have waited for a person into one that drives a browser
is a behaviour change.

## Quality and retry

Two layers of checking:

**Metadata** — resolution against the storage backend's *measured* dimensions (deliberately not the
generation provider's own claim), scene duration, scene completeness, character consistency by
perceptual hash.

**Media** — added by the merge: file integrity, video stream presence, frame rate, codec, audio
presence, black frames, duplicate frames, caption presence, scene ordering. These read the file
itself, which catches what metadata cannot: a render that is the right length, the right resolution
and entirely black.

Every check treats "could not determine" as *no issue*. A check that fires because a regex missed
would send a good render back through the most expensive job in the application.

Errors trigger retry, warnings are recorded. `core/quality/retry.ts` decides *which stage* owns the
fault: a black clip goes back to video generation, not render — it was black before the renderer
saw it. Where several stages are implicated the earliest runs. Where none owns the fault it asks
for a human rather than guessing.

## Character consistency

Unchanged by the merge. A character sheet is generated across ten poses from one spec; the
front-view is the reference every later scene image is conditioned on; `computeDHash` /
`dHashSimilarity` score each generation against it, and a score below the profile's threshold is a
warning that drives a retry of the character stage.

The perceptual hash is honest about what it is: a 64-bit difference hash, a structural heuristic
that catches a generation gone badly wrong, not vision-model identity matching.

## Observability

Every job carries `correlationId`, `parentJobId`, `provider`, `model`, `costPolicy`,
`estimatedCost`, `actualCost` and timings. One production shares a correlation id, so the whole run
is traceable as a unit — including which provider actually served each stage after gateway routing
and any fallback.
