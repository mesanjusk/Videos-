# Migration

## What you have to do

**Nothing, to keep working as before.** The merge is additive: no collection was renamed, dropped
or restructured, no existing environment variable changed meaning, and every new feature is off by
default. A deployment that pulls this and changes nothing behaves exactly as it did.

The rest of this document is about what you *may* want to do, and the two things worth knowing.

## The encryption key

The two projects used incompatible AES-256-GCM ciphertext layouts under different variable names:

| | Layout | Key variable |
|---|---|---|
| AI Video Studio | `base64(iv):base64(tag):base64(ct)` | `ACCOUNTS_ENCRYPTION_KEY` |
| Browser Automation OS | `base64(iv ‖ tag ‖ ct)` | `ENCRYPTION_KEY` |

Rows written by one could not be read by the other, so picking a winner would have made every
existing encrypted Google account token, Instagram token and browser session unreadable.

**What the merged code does:** `decrypt()` detects the layout and reads both. `encrypt()` keeps
writing the colon-joined one, so ciphertext written after this merge is still readable by pre-merge
code and a rollback stays safe. The key is read from `ENCRYPTION_KEY`, falling back to
`ACCOUNTS_ENCRYPTION_KEY`.

**What you should do:** nothing required. Optionally rename the variable to `ENCRYPTION_KEY` — the
value stays the same. Do not set both to different values.

**No re-encryption pass exists or is needed.** If you rotate the key itself, existing rows become
unreadable; there is no recovery path, by design.

## New collections

Created lazily on first write. Nothing to run.

`Workflow`, `WorkflowVersion`, `Automation`, `AutomationTask`, `Execution`, `ExecutionStep`,
`Schedule`, `Webhook`, `HumanIntervention`, `Credential`, `StoredFile`, `AuditLog`,
`ProductionPlan`.

Three carry names deliberately different from their Project B originals:

- `Task` → **`AutomationTask`**. A `Job` collection already exists for queue work, and two things
  both called "the task" is a standing source of confusion.
- `File` → **`StoredFile`**. `File` is a global. It is also kept distinct from the existing `Asset`
  collection: an Asset is a production artifact a render consumes, a StoredFile is run evidence
  with a different lifetime.
- `ApiKey` → **dropped**. The existing `ApiToken` does the same job and the Claude Code plugin
  authenticates with it.

## New fields on existing collections

All optional, so every existing document remains valid.

**`Job`** — `correlationId`, `parentJobId`, `provider`, `model`, `costPolicy`, `estimatedCost`,
`actualCost`, `startedAt`, `completedAt`, `durationMs`.

**`ProductionProfile.render`** — `renderer` (default `ffmpeg`), `costPolicy` (default `BALANCED`),
`browserFallback` (default `false`). The defaults reproduce existing behaviour exactly.

## Dropped from Project B

`User` and password authentication — this application uses Auth.js with Google OAuth, and adding a
second login path to a multi-tenant app is a regression, not a feature. `ApiKey`, superseded.
`AIRequest`, superseded by the observability fields on `Job`.

## Tenancy

Project B's models carried `createdBy` for attribution but nothing filtered on it — it was
effectively single-tenant. Every collection in this application is scoped by `userId` and filtered
on it in every query, and every ported model gained that field.

**If you are importing data from a Browser Automation OS deployment**, you must set `userId` on
every imported document to the owning Auth.js user id. A document without it is invisible (every
query filters on `userId`), which fails closed rather than leaking — but it is still an import you
have to do deliberately. There is no automatic importer, because mapping Project B's `User`
documents onto Auth.js identities is a decision only you can make.

## Rolling back

The merge is a fast-forward on a branch. Reverting to the `pre-merge-checkpoint` tag restores the
pre-merge tree. Data written by the merged code stays readable, because:

- new collections are simply unused by the old code;
- new fields are optional and ignored;
- ciphertext is written in the layout the old code already reads.

The one thing that does not roll back is data in the new collections — a workflow you created will
not be visible to the pre-merge app, because it has no model for it.
