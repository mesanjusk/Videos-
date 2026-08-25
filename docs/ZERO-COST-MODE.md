# Zero Cost Mode

## What it guarantees

Under `ZERO_COST`, the system will not use a provider that costs money. If no free route exists for
a stage, the run **fails with an explanation** rather than falling back to a paid provider.

That last sentence is the whole design. A fallback that costs money would turn the policy someone
selected specifically to avoid spending into the thing that spends.

## The four policies

| Policy | Behaviour |
|---|---|
| `ZERO_COST` | Only providers verified to cost nothing. Refuses rather than escalating. |
| `FREE_PREFERRED` | Prefers free, uses paid when no free route exists. Forbids nothing. |
| `BALANCED` | Whatever is configured as preferred. **The default.** |
| `BEST_QUALITY` | Prefers the paid provider, on the assumption that if you are paying you want it. |

`DEFAULT_COST_POLICY` sets the deployment default; a production profile or a per-run request
overrides it. The default is `BALANCED`, so a deployment that changes nothing behaves as it always
did.

## Unverified cost counts as paid

`unknownCostPolicy` — the default for any provider that does not declare one — behaves identically
to paid at every decision point. This is deliberate and occasionally inconvenient.

The reasoning: "we don't know what this costs" and "this is free" are different answers, and only
one of them is safe to act on. It also means the failure mode of adding a provider and forgetting
to classify it is *it cannot run under ZERO_COST*, never *it ran and billed someone*.

`ZERO_COST_MODE_MUST_NOT_SPEND` (`src/core/cost/zero-cost-mode.test.ts`) walks the real shipped
provider table rather than fixtures, so that mistake fails the suite.

## Two classifications that surprise people

**Gemini is not free.** Google's API has a free allowance and bills past it. Nothing inside a
running job can tell which side of the allowance it is on, so it is `meteredFreeTierCostPolicy`:
preferred under `FREE_PREFERRED`, refused under `ZERO_COST`.

**OmniRoute is not free.** A gateway is a transport, not a pricing model — its cost is whichever
upstream it selected, which this application cannot see. If you have verified that specific models
on *your* gateway cost nothing, name them in `OMNIROUTE_ZERO_COST_MODELS` and only those become
eligible. That verification is yours to do; this code will not assume it.

## What is actually reachable under ZERO_COST

| Capability | Free route | Requires |
|---|---|---|
| Text / script / planning | Local LLM | `ENABLE_LOCAL_AI=true`, `LOCAL_AI_LLM_URL` |
| Images | Local image worker | `ENABLE_LOCAL_AI=true`, `LOCAL_AI_IMAGE_URL` |
| Voice | Voicebox | `ENABLE_VOICEBOX=true`, `VOICEBOX_URL` |
| Rendering | FFmpeg | nothing — always available |
| HTML overlays | HyperFrames built-in compositor | `ENABLE_HYPERFRAMES=true` |
| Storage | Local disk | `STORAGE_PROVIDER=local`, and not on Vercel |
| Video generation | **none** | see below |

**Video generation has no free API route.** Google Flow has no public API; the browser-automation
path drives a signed-in account whose plan this application cannot inspect, so it is classified
`unknown` and refused under `ZERO_COST`. A zero-cost production today produces images, narration
and a rendered composition — it does not produce AI-generated video clips. That is stated here
rather than papered over.

## Running one

```bash
ENABLE_LOCAL_AI=true \
LOCAL_AI_LLM_URL=http://localhost:11434 \
LOCAL_AI_IMAGE_URL=http://localhost:9000 \
ENABLE_VOICEBOX=true \
VOICEBOX_URL=http://localhost:8080 \
STORAGE_PROVIDER=local \
DEFAULT_COST_POLICY=ZERO_COST \
npm run dev:all
```

Or per run: select **zero cost** in the Create Video panel, or set `costPolicy: "ZERO_COST"` on the
production profile.

## What a refusal looks like

```
NoPermittedProviderError: No provider for "image" is available under cost policy ZERO_COST.
Considered: gemini (Google AI Studio API key; free allowance then metered — not ZERO_COST-safe:
exceeding the allowance bills silently.), ideogram (not configured or unreachable),
local-image (not configured or unreachable).
```

Every candidate and the reason it was rejected — enough to fix it without reading the source.

## Turning it off entirely

`ENABLE_ZERO_COST_MODE=false` forbids the policy for the whole deployment. A request for it then
**throws** rather than silently downgrading to `BALANCED`: quietly downgrading would mean a caller
who asked not to spend money then spends it.
