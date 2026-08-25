# Rendering

## FFmpeg is not replaced

`src/core/ffmpeg/compose.ts` was not edited by the merge. Not "mostly unchanged" — not edited.

It is a hand-tuned filter graph: per-clip scale/crop to portrait with a Ken Burns `zoompan`, a
pairwise `xfade` chain, per-scene narration padded with `anullsrc` silence so the audio crossfades
stay aligned with the video ones, a music bed mixed at 0.2, subtitles burned through libass because
the bundled build has no `drawtext`, and an optional watermark overlay. Duration is read by parsing
`ffmpeg -i` stderr, because `ffmpeg-static` ships no `ffprobe`. The file records that this graph was
verified against real clips before it was trusted.

That is not the kind of thing to rewrite because a newer tool exists. `FFmpegRenderProvider` is a
thin adapter that calls it.

## The three renderers

| Renderer | What it does | Available |
|---|---|---|
| `ffmpeg` | The existing composition, unchanged. **Default and fallback.** | Always |
| `hyperframes` | HTML/CSS overlays only — no muxing, no audio | Resolves to `hybrid` |
| `hybrid` | FFmpeg composition + HyperFrames overlays on top | `ENABLE_HYPERFRAMES=true` |

Asking for `hyperframes` alone resolves to `hybrid` on purpose. HyperFrames composes overlays; it
does not mux, transcode, concatenate or mix audio. Honouring a bare `hyperframes` request literally
would produce a video with no sound.

Selected per production profile (`render.renderer`) or by the Director's plan. Defaults to
`ffmpeg`, so an existing project renders through the exact path it always did.

## What each tool is for

**FFmpeg** — muxing, transcoding, audio mixing, concatenation, format conversion, final encode,
burned subtitles. The things it is best in the world at.

**HyperFrames** — animated text, lower thirds, title cards, charts, transitions, anything that is
really a web page moving. Work FFmpeg can technically do and is genuinely awkward at.

## How hybrid works

1. FFmpeg composes the base video. Same graph, same output as `ffmpeg` alone.
2. HyperFrames composes the overlays into one transparent VP9/WebM track.
3. One final FFmpeg pass overlays the second on the first — a single `overlay` filter with the
   audio stream-copied.

Step 3 is the only new FFmpeg invocation the merge adds, and it is deliberately trivial.

## The HyperFrames backends

**External service** — set `HYPERFRAMES_URL`. `POST /compose` with the overlay set, get a
transparent overlay video back.

**Built-in compositor** — otherwise. Headless Chromium (Playwright, already a dependency for
browser automation) screenshots each overlay across its time range with `omitBackground`, and
FFmpeg encodes the frames to VP9 with `yuva420p` — the combination that actually preserves alpha;
libx264 does not.

Stated plainly: the built-in compositor is a working local implementation of the same capability,
written here because it needs nothing installed beyond what the worker already has. It is not a
claim to be someone else's renderer. Point `HYPERFRAMES_URL` at the real HyperFrames and you get
that instead.

Capture is deterministic — CSS animations are paused and positioned by a `--progress` custom
property rather than played, so two runs of the same overlay produce the same frames.

## Degrading

The hybrid renderer never loses a finished video to a failed overlay. No overlays, HyperFrames
disabled, or the overlay pass throwing all produce the FFmpeg-only result with a warning recorded
on the job. Losing a rendered video because a lower third didn't composite would be the wrong trade
every time.

Warnings are surfaced, never dropped: `FFmpegRenderProvider` says out loud that it cannot compose
HTML overlays rather than silently ignoring them.

## Where rendering runs

The worker, never a serverless function. `render`, `automation_workflow` and every browser-backed
job type are registered in `worker-only-processors.ts`. HyperFrames drives Chromium, which puts it
firmly on the same side of that line.
