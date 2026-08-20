# Technical Design

## Scope Model

Use one discriminated Main/shared contract:

```text
ConversationScope =
  | { kind: 'project'; workspaceId }
  | { kind: 'projectless' }
```

Main resolves the scope to a trusted runtime target:

```text
project
  cwd = canonical path stored for the user-selected workspace

projectless
  cwd = userData/general-chat/workspace
```

No empty workspace, fake UUID, implicit home directory, or renderer-provided
path participates in resolution. The host does not supply `--session-dir`; Pi's
normal `PI_CODING_AGENT_SESSION_DIR`, `sessionDir` setting, and default behavior
remain authoritative.

## Session Location Discovery

After every successful scope activation, Main requests official `get_state` and
derives the scope's observed catalog directory from
`dirname(state.sessionFile)`. `ObservedPiSessionDirectoryRepository` stores only
that per-scope directory pointer and observation time. It contains no transcript
rows and may be discarded or replaced at any time.

The app never hard-codes Pi's default root, reimplements its cwd encoding, or
parses Pi settings to predict the result. A never-activated scope has no observed
directory and therefore no offline catalog yet. Activating that scope through a
user command learns it; expanding a row alone does not spawn Pi. Each later
activation overwrites the observation so changes to the user's Pi environment or
settings take effect naturally.

`sessionFile` is optional in the official 0.84.1 response. Its absence produces
a typed `activationUnavailable` result and is never passed to `dirname`. Observed
directories persist in one current-version Main-owned metadata document so
already learned inactive scopes remain navigable after restart. Each scope keeps
at most eight recent observations; a successful activation replaces the active
pointer and prunes older entries. There is no migration reader.

## Catalog Service

`OfficialPiSessionCatalog` receives the scope resolver plus the last observed Pi
directory and exposes bounded `list(scope, cursor?)` plus
`resolve(scope, selectionToken)`. It scans direct files only, rejects
non-regular/symlink/out-of-root candidates, and returns immutable summary rows.
It admits at most 200 candidates, 8 MiB per file, 64 MiB per refresh, eight
concurrent readers, and 50 returned rows per page. Every admitted file is parsed
as a stream through EOF so the latest appended `session_info` record wins.
Missing observation is a typed
`notLoaded` result rather than a guessed path.

Only the current v3 header is accepted. Its canonical `cwd` must exactly match
the Main-resolved canonical cwd for the requested scope. This mirrors official
Pi's own list filtering and prevents a shared custom session directory from
mixing projects. Modified time follows the verified official 0.84.1 projection:
latest user/assistant activity timestamp, then header timestamp, then
`stat.mtimeMs` as fallback. Ties sort by session ID and canonical-file token.
Duplicate upstream session IDs remain separate rows
because the opaque token binds the canonical file identity; activation confirms
both official `sessionId` and canonical `sessionFile`.

The selection token is opaque to the renderer and binds scope, session ID, and
the file identity needed to detect stale replacement. Main resolves and
revalidates it immediately before host startup. Paths never cross preload IPC.

Catalog pagination is deterministic by modified time, then session ID. Cursors
carry ordering state rather than an arbitrary path. Per-scope cache entries are
invalidated after successful `new_session`, `set_session_name`, `fork`, and
`clone` responses, on `agent_settled`, `session_info_changed`, extension
`entry_appended`, or explicit navigation refresh. The official protocol has no
`session_start` event; no synthetic lifecycle event is invented. The cache is
metadata-only and disposable.

## Runtime Handoff

Selecting a row asks the local Pi host to replace its owned process with the
resolved `cwd` and session file. The host invokes only the latest verified public
CLI contract, does not pass `--session-dir`, and hydrates from documented RPC
snapshots/events. If Pi rejects the file or reports a different session, the
operation fails and the prior UI cannot be populated from catalog content. The
successful state then refreshes the observed directory.

Selection never uses renderer-issued `switch_session`. It uses generation-safe
host replacement plus `--session <absolute file>` so process cwd, project
resources, and session identity are established as one Main-owned operation.

New sessions are created by starting the target scope and issuing official
`new_session`; rename/fork/clone use official RPC. The catalog performs no write.

## Fresh-State Policy

This is a greenfield data model. Startup creates only the projectless cwd when
that scope is used; Pi creates and owns all session directories. PiPilot does not
inspect, move, import, delete, or alias prior development paths such as
`agent-workspace` or `agent-sessions/default`.

## Failure And Verification

Expected catalog failures are typed as unavailable, stale, malformed,
unsupported, or bounded-limit diagnostics. One invalid row does not hide valid
rows. Tests use current-format fixtures produced for the supported Pi contract,
not legacy migration fixtures.

Rollback is a code revert before release. There is no on-disk downgrade or
compatibility path to maintain.

The catalog owns the shared scope schema and read-only scope resolver core. The
projectless child owns persisted active-scope navigation and delegates cwd
resolution to that core rather than defining a second resolver.
