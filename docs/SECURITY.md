# Security

## Audit performed for the merge

Both codebases were read for the categories below. Findings are listed with what was done about
them; nothing found is left undocumented.

### Fixed during the merge

**Path traversal in browser downloads.** `PlaywrightActionEngine.downloadFile` joined
`download.suggestedFilename()` — a string chosen by the remote page — straight onto the output
directory. A hostile or merely broken site suggesting `../../etc/cron.d/payload` wrote there. Now
reduced to a sanitised basename (`safeFileName`, tested).

**Path traversal in the local file route.** The version ported from Project B checked containment
with `resolved.startsWith(baseDir)`, which accepts `<baseDir>-anything` — `/srv/storage-evil` does
start with `/srv/storage`. Replaced with a `path.relative` check.

**Cross-tenant data exposure.** Project B's models carried `createdBy` for attribution but nothing
filtered on it; it was effectively single-tenant. Grafted onto this multi-tenant application
unchanged, any user could have read and run any other user's workflows, credentials and browser
sessions. Every ported model gained a required indexed `userId` and every query filters on it. This
was the highest-severity risk in the merge.

**Unscoped browser execution logs.** `BrowserExecutionLog` was keyed on `runId` alone, and a
`runId` is a Job id — a reader holding one could read another user's run history, which for a
browser run means the pages it visited and the steps it took. Nothing called the unscoped reader
yet, so there was no live exposure, but it was one wiring-up away. It now carries `userId` like
every other collection. Found by `modules/automation/tenancy.test.ts`, which asserts the property
structurally so the next model added cannot repeat it.

**Browser storage state loaded by default.** `BrowserSession.storageStateEnc` relied on every query
remembering to write `-storageStateEnc`; one forgotten exclusion would have put an encrypted
session in a JSON response. Now `select: false`, with the two worker call sites asking for it
explicitly.

**Unbounded rate-limit map.** The ported limiter grew a bucket per key forever. Now bounded, with
expired-entry sweeping.

**Replayable webhook signatures.** The ported delivery signed the body alone, so a captured
delivery could be replayed indefinitely. Now signs `timestamp.body` with the timestamp in its own
header.

**Encryption format incompatibility.** Two AES-256-GCM layouts under two key names. Unified with a
dual-format reader rather than a winner, so no existing encrypted row became unreadable. See
[MIGRATION.md](./MIGRATION.md).

### Accepted, with the reasoning

**`EXECUTE_JS` workflow node.** Runs author-supplied script via `new Function`. It is author-
supplied, not AI-generated — the AI agent has no code-execution tool — and a workflow author is
already trusted with the credentials the workflow uses. It is scoped to the author's own tenant. If
you operate this for users you do not trust, remove `EXECUTE_JS` from `NODE_TYPES`.

**`NAVIGATE` accepts any URL.** A workflow author can point a browser anywhere. `AI_ALLOWED_DOMAINS`
constrains the *AI agent* specifically, which is the case where the URL is not human-chosen. A
deployment serving untrusted authors should enforce an allowlist on authored nodes too; the hook
for it is `enforceAgentSafety`.

**Screenshots may capture sensitive page content.** A screenshot of a logged-in page is evidence
and may contain personal data. They are stored through the normal storage backend with an
`expiresAt` field for cleanup, and are only readable by the owning user. Password *values* cannot
appear in the AI's context, since `buildPageSnapshot` excludes raw HTML.

**In-memory rate limiting is per-instance.** On Vercel the effective limit is
`limit × instances`. It is a backstop against a runaway client, not a distributed quota, and says
so in its own comment. Use Redis if you need a true global limit.

## Secrets

| Secret | At rest | Exposure |
|---|---|---|
| Google account API keys | AES-256-GCM | Worker only |
| Instagram tokens | AES-256-GCM | Server only |
| Browser storage state | AES-256-GCM, `select: false` | Worker only |
| Workflow credentials | AES-256-GCM, `select: false` | Worker only, audited on every read |
| Webhook signing secrets | AES-256-GCM, `select: false` | Worker only |
| API tokens | SHA-256 hash | Never recoverable after creation |

`select: false` means the field is not loaded unless explicitly requested, so a careless `.lean()`
or `res.json(doc)` cannot leak it. That discipline came from Project B and is worth keeping.

**Nothing secret reaches the frontend.** No API key, cookie, session token or encrypted credential
is serialised into a page or an API response. `redactSecrets` is the mechanical backstop for
anything about to be logged or put into a prompt.

## Audit log

`AuditLog` records credential reads and writes, browser session connections, automation runs and
human-intervention resolutions. `writeAuditLog` is the only writer and redacts metadata against any
secret values passed to it. It never fails the operation it is recording — losing a line is bad,
failing a user's action because the log write failed is worse.

## Authentication

Auth.js v5 with Google OAuth. Project B's credentials-and-bcrypt login was **not** carried over:
adding a second authentication path to a multi-tenant application is a regression, not a feature.

Non-browser callers (the Claude Code plugin's MCP server) use `ApiToken` bearer tokens. A
present-but-invalid bearer header fails closed rather than falling back to a session cookie that
happens to be on the same request.

## Reporting

If you find something in this list that is wrong, or something not in it, the fix belongs in the
same commit as the finding.
