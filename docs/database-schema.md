# Database Schema

MongoDB Atlas via Mongoose. Every collection is scoped by `userId` (the NextAuth user id — see
`core/auth/auth.ts`), and every service function filters by it — there is no cross-user query path.

## User identity

There is no app-defined `User` model. NextAuth's MongoDB adapter (`@auth/mongodb-adapter`) owns the
`users`/`accounts`/`sessions`/`verificationTokens` collections directly via the native `mongodb`
driver (`core/db/mongo-client.ts`). Every other collection below stores that user's id as a plain
`userId: String` field rather than a Mongoose ref, since the adapter's collections aren't Mongoose
models.

## GoogleAccount (`modules/accounts/models/GoogleAccount.ts`)

The pooled generation-account manager (ARCHITECTURE.md §3) — distinct from the NextAuth login above.

| Field | Type | Notes |
|---|---|---|
| `userId` | String | owner |
| `email`, `displayName`, `avatarUrl` | String | |
| `credentials.apiKeyEnc` | String | AES-256-GCM ciphertext of the Gemini API key |
| `status` | enum | `active` \| `disabled` \| `quota_exceeded` \| `error` |
| `isDefault` | Boolean | tiebreak only — selection is otherwise least-recently-used |
| `quota.dailyLimit`, `quota.used`, `quota.resetsAt`, `quota.lastError` | | `dailyLimit: 0` means unbounded/unknown |
| `lastUsedAt` | Date | |
| `currentJobIds` | [ObjectId → Job] | |

Unique on `{userId, email}`.

## Settings (`modules/settings/models/Settings.ts`)

One document per user.

| Field | Type |
|---|---|
| `userId` | String, unique |
| `providerOverrides.{story,image,video,voice}` | String — a provider id from `core/ai/registry.ts`, or unset for the env default |
| `theme` | `light` \| `dark` \| `system` |
| `defaultLanguage` | String |

## Project (`modules/projects/models/Project.ts`)

| Field | Type | Notes |
|---|---|---|
| `userId`, `title` | String | |
| `language`, `videoType`, `durationSeconds`, `targetPlatform` | | wizard step 1 |
| `style` | enum | Pixar \| Disney \| Anime \| Realistic \| 3D \| Custom |
| `customStyleDescription` | String | only when `style === "Custom"` |
| `storyInputMode` | `idea` \| `script` | |
| `premise` / `pastedScript` | String | one or the other, per `storyInputMode` |
| `storyJson.{title,characters,scenes}` | | the structured output of story generation (ARCHITECTURE.md §5) |
| `status` | enum | `draft` → `story` → `characters` → `backgrounds` → `scenes` → `rendering` → `done` |
| `completionPercent` | Number 0–100 | |
| `musicAssetId` | ObjectId → Asset | optional, user-uploaded (no music-generation provider — see ARCHITECTURE.md §9) |
| `watermarkImageUrl` | String | optional |
| `finalVideoAssetId`, `thumbnailAssetId` | ObjectId → Asset | |
| `thumbnailTitle`, `thumbnailDescription`, `thumbnailTags[]` | | composed alongside the thumbnail, no extra AI call |

## Character (`modules/characters/models/Character.ts`)

| Field | Type |
|---|---|
| `projectId`, `userId` | |
| `name`, `role` | String |
| `spec.{age,bodyType,face,eyes,hair,clothes,shoes,accessories,personality}` | the PDF's character-sheet attributes |
| `sheetAssets[]` | `{ pose: CharacterPose, assetId: ObjectId → Asset }` |
| `voiceProfile.{gender,age,tone}` | used by the voice processor for this character's dialogue |
| `promptTemplateId`, `version`, `previousVersions[]` | reserved; not actively used yet |

Unique on `{projectId, name}`.

## Background (`modules/backgrounds/models/Background.ts`)

`projectId`, `userId`, `name`, `category` (indoor/outdoor/forest/temple/city/village/beach/mountains/custom),
`description`, `style`, `lighting`, `assetId → Asset`.

## Scene (`modules/scenes/models/Scene.ts`)

One per story scene, auto-created when story generation completes (`modules/scenes/service.ts#createScenesFromStory`).

| Field | Type | Notes |
|---|---|---|
| `projectId`, `userId`, `index` | | unique on `{projectId, index}` |
| `visual`, `dialogue`, `camera`, `emotion` | String | from the story JSON |
| `characterIds[]`, `backgroundId` | ObjectId refs | assigned in the Scene Manager |
| `imageAssetId`, `videoAssetId`, `voiceAssetId` | ObjectId → Asset | |
| `videoTaskId` | String | the Google Flow manual hand-off task id |
| `pendingVideoPrompt`, `pendingVideoInstructions` | String | denormalized so the hand-off panel survives a page reload |
| `status` | enum | `pending` → `image_queued` → `image_ready` → `video_pending_manual` → `video_ready` → `voice_queued` → `voice_ready` → `complete` \| `failed` |

## Job (`modules/jobs/models/Job.ts`)

The source of truth the UI polls (`GET /api/jobs/:id`) — every async unit of work.

| Field | Type | Notes |
|---|---|---|
| `userId`, `projectId`, `sceneId?`, `characterId?` | | |
| `type` | enum | `story` \| `character_image` \| `background_image` \| `scene_image` \| `scene_video` \| `voice` \| `render` \| `thumbnail` |
| `status` | enum | `queued` → `running` → `completed` \| `manual_pending` \| `failed` \| `cancelled` |
| `attempts` | Number | |
| `googleAccountId` | ObjectId → GoogleAccount | which pooled account served this attempt |
| `payload` | Mixed | processor-specific input (e.g. `{ backgroundId }`) |
| `result` | Mixed | processor-specific output |
| `error` | String | set only once BullMQ's attempts are exhausted |
| `progress` | Number 0–100 | |
| `bullJobId` | String | correlates to the BullMQ job in Redis |

## Asset (`modules/assets/models/Asset.ts`)

Every binary artifact in Cloudinary.

| Field | Type |
|---|---|
| `userId`, `projectId` | |
| `kind` | `image` \| `video` \| `audio` \| `music` \| `thumbnail` \| `final_video` |
| `cloudinaryPublicId`, `url` | |
| `width`, `height`, `durationSeconds`, `bytes` | as applicable |
| `version`, `replaces` | reserved for asset version history; not actively used yet |

## PromptTemplate (`modules/prompt-templates/models/PromptTemplate.ts`)

One editable document per `{userId, scope}`, seeded from `core/prompt-engine/templates/*.ts` on
first access (`modules/prompt-templates/service.ts#getOrSeedTemplate`).

| Field | Type |
|---|---|
| `userId` | |
| `scope` | `story` \| `character` \| `background` \| `scene_image` \| `scene_video` \| `voice` \| `thumbnail` |
| `name`, `template`, `variables[]`, `appendConsistencyFormula`, `isDefault` | |

Unique on `{userId, scope, name}`.
