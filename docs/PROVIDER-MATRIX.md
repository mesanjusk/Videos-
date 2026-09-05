# Provider Matrix

Every provider the merged application knows about, with the classification the cost policy actually
uses. Generated from the same source the code reads — `src/core/ai/provider-metadata.ts` — so this
table and the runtime cannot disagree without a test failing.

**On "Free/Paid":** `unknown` is not a gap in this table, it is a classification. It means this
codebase cannot verify the cost, and it behaves exactly like `paid` everywhere. See
[ZERO-COST-MODE.md](./ZERO-COST-MODE.md).

| Provider | Capability | Local/Cloud | Free/Paid | API | Browser | GPU | ZERO_COST | Flag | Requires | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| Gemini (text) | story / planning | Cloud | Paid (free tier then metered) | ✅ | — | — | ❌ | — | `GEMINI_API_KEY` | Working |
| Gemini (image) | image | Cloud | Paid (free tier then metered) | ✅ | — | — | ❌ | — | `GEMINI_API_KEY` | Working |
| Gemini (TTS) | voice | Cloud | Paid (free tier then metered) | ✅ | — | — | ❌ | — | `GEMINI_API_KEY` | Working |
| Google Flow (browser) | video | Browser | Unknown | — | ✅ | — | ❌ | `ENABLE_BROWSER_FALLBACK` (**on** by default) | Chromium + a connected Flow session | The default video route. **Selectors unverified** — see below |
| Google Flow (manual) | video | Manual | Unknown | — | — | — | ❌ | — | none | The fallback when the browser run fails — hands a prompt to a person |
| Ideogram | image | Cloud | Paid | ✅ | — | — | ❌ | `ENABLE_IDEOGRAM` | `IDEOGRAM_API_KEY` | Implemented, untested against the live API |
| Voicebox | voice | Local service | **Free** | ✅ | — | optional | ✅ | `ENABLE_VOICEBOX` | `VOICEBOX_URL` | Implemented, untested against a live server |
| Local image worker | image | Local service | **Free** | ✅ | — | ✅ | ✅ | `ENABLE_LOCAL_AI` | `LOCAL_AI_IMAGE_URL` | HTTP contract; needs an adapter |
| Local LLM | story / planning | Local service | **Free** | ✅ | — | ✅ | ✅ | `ENABLE_LOCAL_AI` | `LOCAL_AI_LLM_URL` | OpenAI-compatible |
| OmniRoute | story / planning | Cloud | Unknown | ✅ | — | — | ❌ by default | `ENABLE_OMNIROUTE` | `OMNIROUTE_BASE_URL` | Implemented, untested against a live gateway |
| FFmpeg | render | Local process | **Free** | — | — | — | ✅ | — | none (bundled) | Working — the default and the fallback |
| HyperFrames | render | Local process | **Free** | — | uses Chromium | — | ✅ | `ENABLE_HYPERFRAMES` | none, or `HYPERFRAMES_URL` | Built-in compositor implemented |
| Cloudinary | storage | Cloud | Paid | ✅ | — | — | ❌ | — | `CLOUDINARY_*` | Working |
| Local disk | storage | Local | **Free** | — | — | — | ✅ | — | writable disk, not Vercel | Working |
| Manual lip-sync | lipsync | Manual | Unknown | — | — | — | ❌ | — | none | Hands off to a person, and so is **skipped** by full-automation runs — see below |

## Licences

Every provider above is reached over its own API or as a separately installed service. No
third-party source is vendored into this application, and no AGPL code is present in it.

## Status, honestly

Where the table says *untested against a live X*, it means exactly that: the integration is written
against the published interface, the availability and failure paths are unit-tested, and nobody has
run it against the real service from this codebase. It will need a first run against a real endpoint
before it can be called verified.

The Google Flow selectors carry a stronger caveat, inherited and unchanged:
`src/core/browser/providers/google-flow/selectors.ts` says so itself. labs.google/flow has no public
API and no documented DOM contract, and this environment has no Google account to verify against.
The selectors are best-effort placeholders following common conventions. An operator with real Flow
access recalibrates them with `npx playwright codegen labs.google/flow`; nothing else needs to
change, and the self-healing resolver (`src/core/browser/selectors/resolver.ts`) means a single
broken selector no longer breaks the run outright.

## Lip-sync is skipped, not queued

Every registered `LipSyncProvider` is `manual`; Hedra, HeyGen and Kling all want a paid key this
project does not have. A full-automation run therefore skips the step rather than parking each
speaking scene on a hand-off nobody is going to complete — `render.processor.ts` composes a scene
from its clip plus its separate voice track whenever no lip-synced asset exists, so lip-sync
improves the result but is not load-bearing.

Requiring it unconditionally is what previously stopped every project with spoken dialogue one step
short of its final file, permanently. Register an API-backed provider in `core/ai/registry.ts` and
the step comes back automatically — `core/queue/orchestrator.ts#canLipSyncAutomatically` asks the
provider rather than hardcoding the answer. Running it by hand on a single scene still works.

## Adding a provider

1. Implement the capability interface under `src/core/ai/providers/<vendor>/`.
2. Add an entry to `PROVIDER_METADATA` **with a cost classification and a stated rationale**.
3. Register it in `src/core/ai/registry.ts`.
4. Give it an `isAvailable()` that returns false when unconfigured.

Step 2 is not optional. A provider with no declared cost policy defaults to `unknown`, which is
safe — but the `ZERO_COST_MODE_MUST_NOT_SPEND` suite asserts every shipped provider has a stated
rationale, so it will fail until you write one.
