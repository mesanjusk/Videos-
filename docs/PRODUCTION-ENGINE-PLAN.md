# Module 6 — AI Production Engine: Audit & Implementation Plan

Scope: design the orchestration layer that lets a producer pick a **Production Profile**, enter a
topic, and have Character/Prompt/Style/Voice/Quality/Render configuration apply automatically —
without duplicating any of Modules 1–5's data or rebuilding their state machines. This document is
the audit + plan requested before any code changes; nothing in this document has been implemented
yet.

## 0. Audit — what already exists (Module 6 must reference, never duplicate)

| Requested capability | Already exists as | Where |
|---|---|---|
| Character reuse ("Shiva, Parvati, Narad...") | Character Library — `assignCharacterToProject`, cross-project by design | `modules/characters/` (Module 1) |
| Prompt reuse, "never duplicate prompts" | `PromptTemplate` already supports **multiple named presets per scope** (`{userId,scope,name}` unique, not `{userId,scope}`) — `createNamedTemplate`/`activateTemplate`/`resetTemplate` | `modules/prompt-templates/` (pre-existing, extended in earlier sessions) |
| Retry Strategy | `QualityCheckFailedError` → `withJobLifecycle`'s existing BullMQ attempts/backoff → `"retrying"` status | `core/quality/errors.ts`, `core/queue/processors/helpers.ts` (Module 5, Module 3) |
| Character Consistency Threshold | `dHashSimilarity` + a hardcoded `CONSISTENCY_WARNING_THRESHOLD = 0.45` | `core/quality/perceptual-hash.ts`, `character-image.processor.ts` (Module 5) |
| Minimum Resolution / Minimum Duration | `checkImageResolution`/`checkVideoDuration`, called with hardcoded `TARGET_IMAGE_4_5`/`TARGET_FINAL_VIDEO`/`SCENE_VIDEO_DURATION` constants | `core/quality/checks.ts` (Module 5) |
| Automatic Continuation ("everything else happens automatically") | `Project.pipelineMode === "full"` → `core/queue/orchestrator.ts` auto-chains scene_image → scene_video → voice → lipsync → render → thumbnail | `core/queue/orchestrator.ts` |
| Queue Status / Retry / Failed visibility | `/queue` dashboard, `Job.status` incl. `"retrying"` | Module 3 |
| Preferred Provider (provider-agnostic) | `Settings.providerOverrides{story,image,video,voice,lipsync}` + `core/ai/registry.ts`'s capability→provider maps | `modules/settings/`, `core/ai/registry.ts` |
| Asset reuse (never regenerate unnecessarily) | Character sheet assets reused via `sheetAssets`; Cloudinary assets never re-uploaded once generated; scene staleness flags (`imageStale`/`videoStale`/`voiceStale`/`lipSyncStale`) already gate exactly this | `modules/scenes/dependencies.ts` |
| "Topic" input | `Project.premise` (used today when `storyInputMode === "idea"`) | `modules/projects/` |
| Pipeline stage visibility, derived not duplicated | `computeStepStatuses()` — a **pure function** deriving step status from real Project/Scene counts, no separately-stored competing state | `src/lib/workflow-steps.ts` (existing precedent this plan follows for the new Pipeline Engine) |

**What genuinely does not exist yet** and is the real scope of Module 6:
1. A reusable, named bundle that references characters + a prompt preset per scope + a style + a
   voice default + quality/render settings, so a project doesn't need 5 manual wizard steps.
2. Style Packs and Voice Packs as independently reusable, named entities (today, style is one enum
   field on `Project`, voice is one embedded object on `Character` — neither is a shared, reusable,
   named library entity).
3. A single "topic → Generate → everything happens" entry point. Today, `pipelineMode: "full"`
   auto-chains generation *once material exists*, but nothing auto-creates the characters/applies a
   style/kicks off the story from a bare topic in one call.
4. Production history / execution audit trail (timing, retries, which profile/prompt/character
   *versions* were used) — nothing today records this; `Job` records individual attempts but not a
   cross-cutting "this run used Profile v3, Character v2, took 4m12s, retried twice" record.
5. Quality/Render targets are hardcoded constants today (Module 5), not per-profile configurable.

## 1. New schema (all new collections — nothing here replaces an existing one)

```ts
ProductionProfile {
  userId, name, description, category, version(Number, default 1),
  status: "draft" | "active" | "archived",
  language, aspectRatio, resolution: {width,height}, fps, sceneDurationSeconds, defaultSceneCount,

  characterIds: [ObjectId -> Character],       // references Module 1's library, never copies
  stylePackId: ObjectId -> StylePack,
  voicePackId: ObjectId -> VoicePack,           // profile-level default; Character.voiceProfile
                                                 // still wins per-character when set (unchanged)
  promptTemplateIds: [ObjectId -> PromptTemplate], // pins specific named presets per scope,
                                                     // e.g. [sceneImagePresetId, storyPresetId]

  quality: {                                    // was hardcoded in Module 5; now overridable
    minResolution: {width,height},
    minSceneDurationSeconds, maxSceneDurationSeconds,
    characterConsistencyThreshold: Number,      // maps to CONSISTENCY_WARNING_THRESHOLD
    retryStrategy: "none" | "quality-triggered" | "aggressive",
    completionRules, exportValidation,
  },
  render: {                                     // abstraction only — no automation added here
    oneSceneAtATime: Boolean,
    maxParallelJobs: Number,
    providerOverrides: { story?, image?, video?, voice?, lipsync? }, // same shape as
                                                                       // Settings.providerOverrides
    retryDelaySeconds, downloadRules, automaticContinuation: Boolean, recoveryStrategy,
  },
}

StylePack {
  userId, name, category,             // "Ultra Realistic", "Pixar", "Mythology", ...
  lighting, colorGrading, cameraStyle, composition, motionStyle, renderStyle,
}

VoicePack {
  userId, name,
  gender: "male" | "female" | "child" | "narrator",
  language, speakingSpeed: Number, emotion,
}

ProductionRun {
  userId, projectId, profileId, profileVersion: Number,   // snapshot, not a live join —
                                                             // history must survive later profile edits
  startedAt, completedAt, executionTimeSeconds,
  retryCount, failedSceneIds: [ObjectId],
  generatedAssetIds: [ObjectId],
  promptTemplateVersionsUsed: Mixed,   // {scope: templateId} snapshot at run time
  characterVersionsUsed: Mixed,        // {characterId: version} snapshot at run time
  providerUsed: Mixed,                 // {capability: providerId} snapshot at run time
  stage: "planning"|"ready"|"generating"|"rendering"|"downloading"|"quality_check"|"retry"|"completed"|"failed",
}
```

`ProductionRun.stage` is written at the same points the orchestrator already transitions
Project/Scene/Job state — it is a **record of what happened**, not a second engine deciding what
happens next. The *live* current stage for an in-progress run is still derived the same way
`computeStepStatuses()` already derives step status: a pure function reading real Project/Scene/Job
data, so the UI never trusts a field that can drift out of sync with reality.

## 2. Additive-only changes to existing models

Nothing existing is rewritten. Two optional fields, same pattern as Module 1's additive Character
changes (`masterPrompt`/`animationStyle`/`colorPalette` were all added the same way):

- `Project.activeProfileId?: ObjectId -> ProductionProfile` — which profile (if any) created this
  project. Absent for every project created the existing manual-wizard way; those keep working
  identically.
- `Project.promptTemplateOverrides?: Record<scope, ObjectId>` — lets a profile pin specific named
  presets. `resolveActiveTemplate(userId, scope)` (Module 8's existing function) gains one optional
  parameter: `resolveActiveTemplate(userId, scope, overrideTemplateId?)` — when provided, look that
  template up directly instead of the `isDefault` one; when omitted (every existing call site),
  behavior is byte-for-byte unchanged.

`Character`, `PromptTemplate`, `Scene`, `Job`, `Asset`, `Settings`, `Background` schemas: **no
changes**. `Character.voiceProfile` continues to win over a profile's `VoicePack` default when set
— the override direction that already exists for provider selection (`Settings.providerOverrides`
as the fallback, a more specific setting winning) is reused, not reinvented.

## 3. Service + API surface (new modules only)

```
modules/production-profiles/  — model, schema, service (CRUD + generateFromProfile(userId, profileId, topic, notes?))
modules/style-packs/          — model, schema, service (simple CRUD, mirrors modules/prompt-templates' shape)
modules/voice-packs/          — model, schema, service (simple CRUD)
modules/production-runs/      — model, service (create/list/get, snapshot-on-create)

core/production-engine/
  compute-stage.ts            — pure function, same precedent as lib/workflow-steps.ts#computeStepStatuses
  generate.ts                 — the "topic → Generate" entry point: creates Project from profile
                                 defaults, assigns profile.characterIds via existing
                                 assignCharacterToProject (Module 1), sets pipelineMode="full",
                                 sets promptTemplateOverrides from profile.promptTemplateIds,
                                 enqueues "story" with topic as premise, creates a ProductionRun.
                                 Everything after story generation is the existing orchestrator —
                                 this function does not reimplement any generation step.

/api/production-profiles            GET/POST
/api/production-profiles/[id]       GET/PATCH/DELETE
/api/production-profiles/[id]/generate   POST {topic, notes?} -> {project, run}
/api/style-packs, /api/style-packs/[id]
/api/voice-packs, /api/voice-packs/[id]
/api/production-runs, /api/production-runs/[id]
```

Every existing route (`/api/projects`, `/api/scenes/*`, `/api/characters/*`, `/api/queue/tick`, ...)
is untouched.

## 4. UI (new pages only; the existing 5-step wizard keeps working, unremoved)

- **`/production-profiles`** — list, create/edit (character picker reusing the Character Library
  picker component pattern from the project wizard's Cast step; style/voice pack pickers; a prompt
  preset picker listing each scope's named presets from `/api/prompt-templates`; quality/render
  settings form).
- **`/production-profiles/new`** or a dialog — profile builder.
- **New project creation shortcut**: on `/projects/new`, an alternative first step — "Start from a
  Production Profile" — topic + optional notes, calling `/api/production-profiles/:id/generate`.
  The existing 4-step manual wizard remains the other path, unchanged.
- **`/production`** (Pipeline Monitor) — active `ProductionRun`s, current stage (via
  `compute-stage.ts`), execution timeline, estimated completion, links into the existing
  `/queue`/`/projects/:id` pages rather than re-displaying their data natively.

## 5. Recommended phased delivery

This is larger in scope than any single prior module — comparable to Modules 1–5 combined. Proposed
split, each its own PR/deploy exactly like Modules 1–5:

- **6a — Schema + CRUD**: `ProductionProfile`/`StylePack`/`VoicePack` models + services + API +
  `/production-profiles` UI. No orchestration yet — profiles can be built and edited, nothing
  consumes them.
- **6b — Generate-from-topic**: `core/production-engine/generate.ts`, the `/generate` endpoint, the
  `/projects/new` shortcut, `ProductionRun` creation. This is where "topic → Generate → everything
  happens" becomes real.
- **6c — Pipeline Monitor**: `compute-stage.ts` + `/production` dashboard, `ProductionRun` stage
  updates wired into the existing orchestrator transition points.
- **6d — Quality/Render profile wiring**: the four quality-check call sites
  (`character-image`/`background-image`/`scene-image`/`thumbnail` processors, plus
  `scene-video.processor.ts`'s duration check) resolve their target from
  `project.activeProfileId`'s `quality` config when present, falling back to today's hardcoded
  constants when absent — zero behavior change for any project not created from a profile.

No browser automation is added anywhere in Module 6 — `RenderProfile.providerOverrides` is config
only, the same shape `Settings.providerOverrides` already is; it plugs into the existing
provider-agnostic `core/ai/registry.ts`, ready for a future rendering backend without this module
needing to change.
