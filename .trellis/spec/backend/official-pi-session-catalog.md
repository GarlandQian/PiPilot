# Official Pi Session Catalog Contract

## 1. Scope / Trigger

Use this contract whenever Main resolves a project or projectless conversation,
learns Pi's session location, lists official sessions for navigation, opens a
catalog selection, or deletes a complete session selected by the user. Pi remains
the session runtime authority; whole-session deletion is the single approved
filesystem mutation in this catalog boundary.

## 2. Signatures

```ts
scopeResolver.resolve(scope): Promise<ResolvedConversationScope>
scopeResolver.prepare(scope): Promise<ResolvedConversationScope>

observedDirectories.observe(scope, sessionFile): Promise<ObservationResult>
observedDirectories.getState(scope): ObservedDirectoryState

catalog.list(scope, cursor?): Promise<SessionCatalogListResult>
catalog.refresh(scope): Promise<SessionCatalogListResult>
catalog.resolve(scope, selectionToken): Promise<ResolvedSessionSelection>
catalog.consumeForDeletion(scope, selectionToken): Promise<ResolvedSessionDeletion>
catalog.invalidate(scope): void
catalog.listControlTargets(scope): Promise<OfficialPiSessionControlTargetListResult>
catalog.revalidateControlTarget(target): Promise<OfficialPiSessionControlTarget>

activation.start(scope): Promise<LocalPiRuntimeSnapshot>
activation.open(scope, selectionToken): Promise<ConversationActivationResult>
deletion.delete(scope, selectionToken): Promise<SessionCatalogDeleteResult>
```

Renderer contracts contain only a typed scope, bounded summaries, cursors, and
opaque selection tokens. Main resolves every cwd and session file.

The two control-target methods are Main-only. They return canonical target
identity to the External Control inventory/service but never cross preload,
Renderer, stdio, or MCP DTOs.

## 3. Contracts

- `ConversationScope` is exactly `{ kind: 'project', workspaceId }` or
  `{ kind: 'projectless' }`. A project cwd comes from an explicitly selected,
  canonical workspace. Projectless cwd is the fixed
  `userData/general-chat/workspace`, created only by `prepare()`.
- Never infer a Pi session root, scan the disk recursively, reproduce Pi's cwd
  encoding, or pass `--session-dir`.
- Catalog rows are persisted navigation metadata, not live Agent capacity.
  Listing, refreshing, and paging Sessions never starts a Host, allocates a
  Runtime, or reserves a Runtime identity; activation is owned only by
  `start()`/`open()`.
- External Control inventory merges Main-only complete catalog targets with
  retained Runtime summaries. A catalog-only row is `inactive`; a never-observed
  scope yields `not_loaded`. Listing/status cannot allocate a Runtime or change
  desktop selection. Opaque `conv_` identities are derived from an installation
  key plus scope/canonical file identity, never a selection token or encoded
  path.
- After activation, learn only `dirname(get_state.sessionFile)`. Pi may return a
  normalized future file path before the first file write; accept it only when
  its canonical direct parent exists. Missing or invalid state is typed
  `activationUnavailable`.
- Persist only current-version bounded directory observations. Keep at most
  eight directory observations per scope and 101 scopes, pruning the oldest
  observation rather than the newly inserted scope.
- List direct regular `*.jsonl` files only: at most 200 directory candidates,
  64 MiB per file, 256 MiB per refresh, eight concurrent readers, and 50 rows per
  page. Parse each admitted file through EOF.
- Accept only a v3 `session` header whose canonical `cwd` exactly matches the
  Main-resolved scope cwd. The latest appended `session_info` name wins.
- Modified time is the latest user/assistant activity timestamp, then header
  timestamp, then file mtime. Duplicate session IDs remain separate rows.
- Selection tokens and cursors are process-local opaque capabilities. Cursors
  belong to one exact catalog version. A selection token belongs to one exact
  session-file identity and must remain usable while its row is still rendered,
  including during background refresh and append-only JSONL growth. Reuse the
  token across refreshed rows only when canonical path, device/inode, header,
  cwd, selection mode, and session ID still match. Revalidate all of those
  properties immediately before opening.
- Propagate the selected row's opaque token into the retained Runtime identity
  and Sidebar status projection. This is presentation identity only: it must not
  expose or replace the canonical Main-owned session file lease. When duplicate
  session IDs exist, no tokenless status may be guessed onto either row.
- Open by generation-safe host replacement with exact `cwd` and
  `--session <absolute-file>`. Require returned `sessionId` and canonical
  `sessionFile` to match; stop the replacement on confirmation failure.
- Deletion consumes a one-shot opaque selection token and repeats containment,
  regular-file, stat identity, header, cwd, and session-ID validation immediately
  before mutation. No request or result may expose a filesystem path.
- If and only if the exact selected scope and canonical file are active, stop Pi
  before deletion and revalidate afterward. Move the file to the operating
  system Trash first; if Trash is unavailable, revalidate again and unlink it.
  Clear the active session while retaining its selected project scope.
- Determine active deletion ownership from the Runtime frontend's exact
  scope/session-file lease, not from renderer navigation or an activation
  generation cache. A successful session-changing command may publish its new
  Runtime generation before secondary catalog bookkeeping completes.
- Invalidate after successful `new_session`, `set_session_name`, `fork`, and
  `clone` responses, `agent_settled`, `session_info_changed`, extension
  `entry_appended`, explicit refresh, and controlled scope or process
  activation. Official RPC has no session-list or `session_start` event.
- Coalesce concurrent explicit refresh calls per scope. Only the first caller
  invalidates the cache; later callers await the same refresh, while independent
  lifecycle invalidations still advance the version and force a retry.
- A continuous invalidation stream must not keep an explicit Renderer refresh
  pending indefinitely. After at most four foreground scans or 250 ms between
  completed scans, publish the latest coherent scan and finish the caller's
  loading state. Retag that cache to the current version so returned pagination
  cursors remain internally consistent, then run one yielded background
  continuation to converge newer invalidations. Selection remains safe because
  every open/delete operation revalidates the underlying file identity.
- Keep the previous cache available to selection resolution while a newer
  version scans. Publishing `loading` while retaining visible rows creates a
  cross-layer promise: Main cannot revoke those rows before Renderer receives
  their replacement. A completed refresh must reuse unchanged selection tokens;
  it must not require a second click merely because Pi startup re-observed the
  same directory or appended to the same session file.
- Clear a scope's in-flight refresh in an identity-guarded `finally` path after
  either success or failure. A genuinely stale refresh must not poison the next
  explicit refresh, and an older completion must not delete a newer promise.
- Renderer catalog requests are ordered per scope. Superseded results and errors
  must not update catalog state or reach the global operation-error dialog; only
  the latest request may publish an error.
- Before an external mutation, Main calls `revalidateControlTarget` and then
  binds the exact Runtime/Session lease. A moved, replaced, header-changed,
  wrong-cwd, or missing target fails without starting or retargeting another
  Runtime. Runtime-only first-seen inventory state is pruned when the Runtime
  disappears so churn cannot grow memory unboundedly.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Scope has never produced `sessionFile` | `notLoaded`; do not start Pi merely to list |
| Activated Pi omits or returns invalid `sessionFile` | `activationUnavailable` |
| Observed directory disappears or changes identity | bounded `unavailable` result |
| Symlink/non-regular/out-of-root candidate | skip with `unsafeCandidate` diagnostic |
| File exceeds 64 MiB or refresh exceeds 256 MiB | skip with bounded size diagnostic |
| Invalid UTF-8/JSON/header | skip only that file as malformed/unsupported |
| Header cwd differs from resolved scope | skip as `scopeMismatch` |
| File changes during a catalog read | retry/skip that scan without publishing a partial cache |
| Same direct file appends while its rendered selection is used | re-read and accept only if device/inode, header, cwd, mode, and session ID still match |
| Cursor belongs to an old cache | typed stale cursor error |
| Token belongs to another scope, replaced file, changed header/cwd, or removed row | typed stale selection error |
| Pi confirms another session ID/file | stop replacement and return confirmation failure |
| Deletion token is stale, replayed, or belongs to another scope | reject before touching the filesystem |
| Active runtime does not match the selected canonical file | do not stop that runtime |
| Trash fails and the revalidation still matches | unlink the exact regular file |
| Stop, revalidation, Trash, or unlink fails | typed deletion failure; never report success |

## 5. Good / Base / Bad Cases

- Good: activate a selected project, observe Pi's actual session file, lazily
  list current v3 summaries, and open an opaque row through process replacement.
- Base: a fresh project/projectless scope has no observation. Return `notLoaded`
  with no disk guessing and no background Pi process.
- Bad: hard-code `~/.pi/agent/sessions`, expose a renderer session path, trust a
  cached file without restating it, parse only a prefix, or treat an
  undocumented lifecycle event as catalog truth.

## 6. Tests Required

- Scope: project lookup does not activate another workspace; projectless cwd is
  created only by `prepare()`; renderer schemas reject paths.
- Observation repository: missing/future/existing session files, current-version
  persistence, eight-observation pruning, oldest-scope pruning, and corrupt-file
  recovery.
- Catalog: v3/header-cwd filtering, latest EOF name, first user preview,
  duplicate IDs, sorting/pagination, malformed/unsupported/oversized files,
  symlink escape, changed identity, explicit-refresh coalescing across a
  lifecycle-invalidated retry, stale cursors/tokens, unchanged-token reuse,
  append-only selection validation, and one-click selection while startup
  refresh is in flight.
- Activation: exact host target, official ID/file confirmation, generation-safe
  invalidation, missing session state, and failed-replacement stop.
- Cross-layer: catalog IPC/preload accepts only typed scopes/tokens and never a
  renderer path. Deletion tests cover one-shot tokens, exact-active stop,
  inactive deletion, Trash success, unlink fallback, and identity changes.
- External inventory: catalog-only inactive rows, Runtime-only rows, unobserved
  diagnostics, stable opaque identity, stale cursor rejection, revalidation,
  no selection token/path exposure, no Runtime allocation on read, and bounded
  Runtime first-seen pruning.

## 7. Wrong vs Correct

Wrong:

```ts
const root = join(homedir(), '.pi/agent/sessions', encodeCwd(cwd))
return listJsonl(root).map(({ path, ...row }) => ({ path, ...row }))
await host.request({ type: 'switch_session', sessionPath: rendererPath })
catalog.invalidate(scope)
return catalog.list(scope) // every concurrent caller invalidates the shared scan
```

Correct:

```ts
await observedDirectories.observe(scope, state.sessionFile)
const page = await catalog.list(scope)
const refreshedPage = await catalog.refresh(scope)
const selected = await catalog.resolve(scope, opaqueSelectionToken)
await host.replace({
  cwd: selected.cwd,
  sessionFile: selected.sessionFile,
})
```
