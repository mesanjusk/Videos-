# Browser Automation

## It is the route, not a fallback

Google Flow has no public API. Before, `ENABLE_BROWSER_FALLBACK` defaulted off, so every video job
ended by handing a prompt to a person: open labs.google/flow, paste, generate, download, upload it
back. That is not a fallback being declined — it is the pipeline not running.

It now defaults **on**. `scene_video` diverts to `scene_video_auto`, which drives Flow and returns
the MP4 into `completeSceneVideo` like any other provider result. The manual hand-off still exists
and is still exactly what happens when the site run fails, so the worst case is the old behaviour
one queue hop later. Two things gate it, both checked rather than assumed: the flag, and a Google
account with a connected Flow browser session — without a session there is nothing to sign in as.

Set `ENABLE_BROWSER_FALLBACK=false` to force the hand-off and never drive a browser.

## Reading the page instead of guessing at it

Three mechanisms, ported from `mesanjusk/automation`, between "a selector broke" and "here is what
went wrong":

**Screen states.** `providers/google-flow/state.ts` classifies which Flow screen is displayed —
`SIGNED_OUT`, `CHALLENGE`, `WORKSPACE`, `PROMPT_READY`, `GENERATING`, `CLIP_READY`, `ERROR`. The
step sequence ends each phase at a `wait_for_state`, so a signed-out session fails in seconds with
"reconnect this account", a verification challenge fails as one (and is never worked around), and a
slow render just keeps waiting. All three used to be the same message: "element not visible after N
seconds".

**Probing and refs.** `probe_page` reads the live DOM — same-origin iframes included — stamps
`data-vs-ref` on every visible control, and reports role, accessible name, editability and a
generated selector for each. `resolveTarget` tries `ref` ahead of every written-in-advance strategy,
which closes the gap between the element that was seen and an element matching its description —
the classic way an automation clicks the wrong one of five identical buttons.

**Verify after act.** Every mutating action waits for the DOM to settle and records what changed. A
step marked `expectChange` fails when nothing did, so a Generate click that lands on a disabled
button is caught immediately instead of succeeding silently and waiting out a five-minute render
timeout for a clip nobody started.

A fourth, smaller one: `TaskStep.optional`. "Click New project" is right when Flow opens on its
project list and wrong when it opens straight into a workspace, and neither is an error — the state
check that follows is the real gate.

## One engine

Before the merge there were three Playwright implementations across the two projects. There is now
one, at `src/core/browser/`.

The two that survived were **grafted, not chosen between**, because neither was a superset of the
other:

| Capability | From the video studio's framework | From Browser Automation OS |
|---|---|---|
| Pause / resume / cancel across processes | ✅ | ❌ |
| Persisted resume state, crash recovery | ✅ | ❌ |
| Self-healing selector resolution | ❌ | ✅ |
| Secret interpolation that never reaches logs | ❌ | ✅ |
| Control flow (condition, loop, for-each, variables) | ❌ | ✅ |
| Per-node retry with failure classification | ❌ | ✅ |
| AI agent with domain allowlist and action cap | ❌ | ✅ |
| Human-approval pause | ❌ | ✅ |

The lifecycle came from the first, the action layer from the second.
`core/automation/google-flow-driver.ts` — the third, Google-Flow-specific implementation — is
deleted; the same sequence now runs as `TaskStep[]` through the shared engine.

## Self-healing selectors

The single most valuable thing the merge brought over. Previously every selector was
`page.locator(cssString)` against products nobody here controls, and this codebase's own selector
file admits its values are unverified guesses.

`resolveTarget` now tries, in order: `testId` → `css` → `role` → `text` → `aria-label` →
`nearby-text` → `xpath` → AI-visual, and reports which strategy won. A provider can supply several
ways to find one element, and a redesign that breaks one no longer breaks the run.

The winning strategy is persisted on every `ExecutionStep`. That is the early-warning signal worth
watching: a run that still passes but has quietly moved onto a fallback strategy is a site that has
changed and will break properly soon.

A bare string still means `{ css }`, so no provider adapter needed changing.

## Secrets

A workflow references a credential as `{{secret:name}}`. `interpolateWithSecrets` resolves it
just-in-time, straight into the Playwright call. The plaintext is **never** written back into the
run's variable bag — which is what gets persisted to `AutomationTask.variables`, shown in the
dashboard, and passed to an AI prompt.

Credentials are AES-256-GCM encrypted with `select: false`, so they are not loaded — and therefore
cannot be serialised into an API response — unless explicitly requested. Only the worker requests
them, and every read is written to the audit log.

`buildPageSnapshot` (the context the AI agent reasons over) deliberately excludes raw HTML, so a
password field's value cannot reach a model.

## Run model

```
Workflow          a named graph; every save is an immutable WorkflowVersion
Automation        binds a workflow to a browser session and default inputs
AutomationTask    one run — pins the version it started with
Execution         one attempt at that run
ExecutionStep     one node executed: status, output, duration, selector strategy, screenshot
```

A running task pins its workflow version, so editing a workflow never changes an in-flight or
historical run.

## Retry, and why the queue does not do it

`automation_workflow` is enqueued with `attempts: 1`.

The workflow engine retries per node, classifying each failure as `TRANSIENT`, `PERMANENT`,
`AUTHENTICATION`, `HUMAN_INTERVENTION_REQUIRED` or `WEBSITE_CHANGED`, and only retrying the first.
A whole-job retry on top would re-run every step that already succeeded — logging in again,
re-submitting a form, re-downloading a file. Wasteful at best, wrong for anything non-idempotent.

## Human intervention

A CAPTCHA, an MFA prompt or an explicit `HUMAN_APPROVAL` node stops the run and creates a
`HumanIntervention` row. The task holds its resume point and waits.

This is the honest alternative to the two things automation is tempted to do instead: solve the
challenge — which this codebase will not do — or retry blindly until it gives up.

## Cancel and pause across processes

The API runs on Vercel and the run lives in a worker's memory, so there is no in-process handle to
call. The API sets a flag on the task document; the worker polls it every few seconds and forwards
to the engine it does own. Both `BrowserTaskRun` and `AutomationTask` use this mechanism.

## Providers

`ProviderAdapter` is the plugin contract. `browserProviderRegistry` is empty until `worker.ts`
registers concrete adapters at startup, which keeps the engine itself provider-agnostic.

One real adapter ships: Google Flow. Its selectors carry an inherited and unchanged caveat —
labs.google/flow has no public API and no documented DOM contract, and this environment has no
Google account to verify against. `src/core/browser/providers/google-flow/selectors.ts` says so
itself. Recalibrate with `npx playwright codegen labs.google/flow`; nothing else changes.

The state classifier and the probe reduce how much that caveat costs — both read text, roles and
accessible names rather than class names, which is what survives a redesign — but they do not remove
it. One calibration pass against a real signed-in Flow session is still the thing that turns this
from "should work" into "verified".

## Where it runs

The worker, never a serverless function. `worker-only-processors.ts` is the enforcement point, and
it is load-bearing for the Vercel deployment: no route may reach a Playwright import.

## What the UI does not do yet

`/workflows` is read-only. The engine, persistence, scheduler, credentials and API are all working;
a visual node editor is a substantial piece of UI in its own right, and shipping a half-built one
would be worse than showing the state honestly. Workflows are created through
`POST /api/v1/workflows` in the meantime.
