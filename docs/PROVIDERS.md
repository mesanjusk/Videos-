# Providers

Every AI capability is reached through an interface, never a vendor. Business logic calls
`generateImage()`, `generateVoice()`, `generateScript()`, `renderVideo()` — it does not know which
service answered.

For the shipped table with cost classifications, see [PROVIDER-MATRIX.md](./PROVIDER-MATRIX.md).

## The layers

```
business logic
   │  "generate an image"
   ▼
AiGateway            core/ai/gateway     — routes by capability
   │  ├─ cost policy   core/cost         — is this provider even permitted?
   │  ├─ availability                    — is it configured and reachable?
   │  └─ fallback chain                  — who's next if it fails?
   ▼
registry             core/ai/registry    — the one place concrete classes exist
   ▼
provider             core/ai/providers/<vendor>/
```

`core/ai/types.ts` holds the capability interfaces. `core/ai/provider-metadata.ts` holds cost,
requirements, execution kind, flag and fallback order — kept *beside* the provider classes rather
than inside them, because how to call a service and whether a run is allowed to are different
questions with different owners.

## Routing

Within what the cost policy permits, the gateway prefers a local execution path over a cloud API.
Not for cost — the policy already decided that — but because a local service is the one that still
works with no network, no key and no quota.

Fallback re-checks the cost policy for every candidate before using it, and **never escalates
cost**. Under `ZERO_COST` a failing free provider falls back only to another free provider; if
there is none the run fails with an explanation naming every candidate and why each was rejected.

## Adding a provider

1. Implement the capability interface under `src/core/ai/providers/<vendor>/`.
2. Give it `isAvailable(): boolean` returning false when its flag is off or its configuration is
   missing. **Never throw at import time** — an unconfigured provider must be unavailable, not
   broken.
3. Add an entry to `PROVIDER_METADATA` with a cost classification and a stated rationale.
4. Register it in `src/core/ai/registry.ts`.

Step 3 is enforced: `ZERO_COST_MODE_MUST_NOT_SPEND` walks the real provider table and fails if any
entry lacks a rationale, or if a `cloud-api` provider is ever selectable under `ZERO_COST`.

## The local worker contract

`LocalImageProvider` and the local LLM route talk to an HTTP service you run. This is deliberate:
Easy Diffusion, AUTOMATIC1111, ComfyUI and SD.Next all generate locally and none agree on an API,
and building any one of them in would drag its GPU and Python assumptions into an application that
must also deploy to Vercel.

### Image worker

`POST {LOCAL_AI_IMAGE_URL}/generate`

```jsonc
// request
{ "prompt": "...", "width": 1080, "height": 1350, "seed": 12345, "format": "png" }

// response — exactly one of imageBase64 or imageUrl is required
{ "imageBase64": "iVBORw0…", "width": 1080, "height": 1350 }
{ "imageUrl": "http://localhost:9000/out/abc.png" }
{ "error": "CUDA out of memory" }   // surfaced to the job, not swallowed
```

`GET {LOCAL_AI_IMAGE_URL}/health` → any 2xx means up.

`seed` is derived deterministically from the character, so every pose in one character sheet gets
the same seed. Honest limitation: without reference-image conditioning that gives *related* images,
not guaranteed identity — the perceptual-hash consistency check is what catches a pose that drifted
too far.

### LLM

Any OpenAI-compatible `POST {LOCAL_AI_LLM_URL}/v1/chat/completions`. vLLM, llama.cpp's server,
LM Studio and Ollama's compatible endpoint all work unmodified.

### Voicebox

`POST {VOICEBOX_URL}/tts` with `{ text, speaker, language, style, format: "mp3" }`, returning audio
bytes. An `x-audio-duration-seconds` response header is used when present — duration is never
inferred from byte length, since an MP3's bitrate is not knowable from the buffer and the quality
checks would then be validating an invented number.

`GET /health` and `GET /speakers` are optional; `/speakers` feeds a UI dropdown and returns an
empty list on any failure.

## Manual hand-off is a first-class result

`VideoGenerationResult` and `LipSyncGenerationResult` are discriminated unions with a
`manual_pending` variant. A provider with no API says so structurally rather than throwing, and the
pipeline parks the scene for a person with the prompt they need.

This is what browser fallback slots into: when a stage would park on a human and a browser session
exists, the job diverts to browser automation instead — because a provider with no API is not the
same thing as a provider with no route.
