# Voice

## Providers

| Provider | Kind | Cost | ZERO_COST |
|---|---|---|---|
| Gemini TTS | Cloud API | Free allowance, then metered | ❌ |
| Voicebox | Self-hosted service | Free | ✅ |

Gemini is the default and remains unchanged by the merge. Voicebox is optional and off unless
`ENABLE_VOICEBOX=true` and `VOICEBOX_URL` are both set.

## Why Voicebox matters

It is the only voice route classified free, and therefore the only one reachable under
`ZERO_COST`. Without it, a zero-cost production stops at the voice stage with nothing to fall back
to — the pipeline can plan, script and generate images for free, and then has no way to speak.

## Fallback order

Configured per capability in `PROVIDER_METADATA`: `gemini → voicebox`. The gateway re-checks the
cost policy at each step, so under `FREE_PREFERRED` Voicebox is tried first, and under `ZERO_COST`
Gemini is not tried at all.

## Speaker selection

A per-character voice, then the deployment default:

```
VOICEBOX_SPEAKER_ASHA=hi-female-2      # character "Asha"
VOICEBOX_DEFAULT_SPEAKER=hi-female-1   # everyone else
```

The character name is uppercased with non-alphanumerics replaced by underscores.

## Voice cloning

`VoiceboxProvider` exposes **no endpoint for creating a cloned voice from a sample**, and this is
deliberate rather than an omission.

Cloning a voice raises a consent question — whose voice, and did they agree — that belongs with
whoever operates the server and knows the answer. A video pipeline that only knows a speaker id
cannot answer it and should not be the place that decides. If your Voicebox server has voices
installed, this provider will use them; installing one is your decision, made where the context
for it exists.

## Duration

Taken from an `x-audio-duration-seconds` response header when the server sends one, and left
`undefined` otherwise. It is never estimated from byte length: an MP3's bitrate is not derivable
from the buffer, and the audio-duration quality check would then be validating a number this code
made up.

## Storage

Generated audio goes through the storage abstraction like any other asset — Cloudinary by default,
local disk under `STORAGE_PROVIDER=local`. Cloudinary has no distinct audio resource type and
stores audio as `video`; the abstraction handles that, callers say `"audio"`.
