# Technical Design

## Scope And Ownership

This task changes two user-facing session actions while preserving the current
official Pi architecture:

```text
Pi RPC entries/messages
  -> renderer projector provenance
  -> response action turn
  -> MessageList Copy/Fork controls

sidebar opaque selection token
  -> validated IPC/preload contract
  -> Main conversation lifecycle queue
  -> catalog token consumption and revalidation
  -> active-runtime stop when required
  -> Electron trashItem or filesystem unlink
  -> scoped catalog refresh and renderer selection reset
```

Pi remains the session writer and fork authority. The only non-RPC mutation is
whole-session deletion, modeled after Pi's official interactive selector. Main
owns every path and destructive filesystem operation.

The work remains one task rather than parent/children because both deliverables
share `App`, sidebar contracts, locale keys, active-session state, and one
Electron workflow. Implementation may still delegate the provenance and Main
deletion layers with disjoint file ownership before a single integration pass.

## Response Action Projection

### Authoritative Inputs

The provider hydrates `get_entries` with `get_messages` for each ready
generation/session. It stores a generation-scoped entry snapshot:

```ts
interface LocalPiEntrySnapshot {
  generation: number
  sessionId: string
  entries: readonly LocalPiSessionEntry[]
  leafId: string | null
  cursor: string | null
}
```

Initial hydration requests all entries. A settled refresh requests only entries
after `cursor`; it appends them and always replaces `leafId`. If Pi rejects the
cursor, retry one full `get_entries` request. A generation/session change clears
the snapshot. Existing nonces reject late responses.

### Active Context Origins

A pure iterative helper builds an `id -> entry` map, walks `leafId` to the root,
and reverses that path. It then mirrors Pi 0.84.1 context-entry selection:

1. Find the latest compaction on the active path.
2. Without compaction, keep the full path.
3. With compaction, emit the compaction entry, the retained prefix beginning at
   `firstKeptEntryId`, and entries after that compaction.
4. Emit one origin for each entry that Pi converts to a context message:
   `message`, `custom_message`, `compaction`, or `branch_summary`.
5. Verify the origin roles align with `get_messages`. A mismatch keeps the
   transcript and Copy action available but marks Fork provenance unavailable.

No recursive traversal is used; real Pi histories can be thousands of levels
deep. No message text is used as an identifier.

### Response Groups

Projection groups context messages beginning at a visible user message and
ending immediately before the next visible user message. The group contains all
assistant text, thinking, tool calls, tool results, bash messages, and notices in
render order. When a settled group contains non-empty completed assistant text,
projection appends one derived turn:

```ts
type ResponseActionsTurn = {
  kind: 'response-actions'
  id: string
  copyMarkdown: string
  forkEntryId?: string
}
```

`copyMarkdown` concatenates the group's assistant Markdown fragments in render
order with one blank-line boundary. It excludes thinking, tool output, change
summary chrome, sender labels, timestamps, and action metadata. The footer is
not emitted for streaming, aborted, failed, synthetic summary-only, or
assistant-less groups.

### Interaction

`MessageList` renders the footer after the whole group. It uses fixed-size
Tabler icon buttons with tooltips and accessible labels:

- Copy writes `copyMarkdown` through `navigator.clipboard.writeText`, briefly
  replacing the icon with a check mark. Copy failure exposes an inline/announced
  error and does not mutate the conversation.
- Fork sends official `fork { entryId }` immediately. There is no second message
  picker. While pending, that footer shows a spinner and all Fork controls are
  disabled to prevent competing session changes.
- Successful Fork keeps the existing provider behavior: Pi's returned text
  becomes the Composer draft, the official session change invalidates the
  catalog, and the previous transcript stays hidden until full hydration.
- Cancelled Fork restores the current ready view. Failed Fork ends loading and
  uses the existing typed error presentation.

The old sidebar Fork item, `onFork` callback chain, and global Fork dialog are
removed. Duplicate remains a separate official `clone` action in the sidebar.

## Session Deletion

### Shared Contract

Add a strict command adjacent to the catalog contracts:

```ts
sessionCatalog.delete({
  context,
  scope,
  selectionToken,
}): Promise<{
  scope: ConversationScope
  sessionId: string
  activeDeleted: boolean
  disposition: 'trash' | 'unlink'
}>
```

The request contains no path. The result contains no path or file metadata.
Preload validates both directions and only the trusted current window may call
the handler.

### Token Consumption

The catalog factors its existing selection verification into a shared internal
resolver. Opening retains current token semantics; deletion consumes its token
before asynchronous revalidation so double-clicks and replay cannot remove two
files. The resolved Main-only deletion target carries canonical path, scope,
session ID, header identity, and stable filesystem identity.

Moved-session recovery rows delete their selected source file directly; they do
not invoke `--fork`. Every target must still be the direct regular JSONL file
represented by the scoped catalog row.

### Main Lifecycle

`ConversationContextService.deleteConversation()` runs in the same serialized
lifecycle as open/new operations:

1. Consume and revalidate the selected token.
2. Compare exact canonical file and scope with the active runtime snapshot.
3. If they match, stop via `OfficialPiSessionActivationService.stop()` before
   deletion. Session ID alone never establishes an active match.
4. Revalidate the direct regular file, stable identity, and current header after
   stop. Content growth caused by bounded Pi shutdown is allowed; path/inode or
   session identity replacement is not.
5. Call injected `trashItem(canonicalFile)`. If it throws or the path still
   exists, call `unlink(canonicalFile)`.
6. Invalidate only the target scope catalog and return the typed disposition.

If both methods fail after an active runtime was stopped, return a typed
`SESSION_DELETE_FAILED`; do not restart implicitly. The stopped runtime event
and renderer state clear the selected session, so no stale transcript remains.
The still-existing row reappears on the next scoped refresh and can be retried.

### Renderer State And Dialog

The sidebar menu replaces Fork with a destructive Delete item. Selecting it
opens a controlled confirmation dialog naming the session and explaining that
trash may fall back to permanent deletion. If the row is currently active, the
dialog also says the active Pi run will stop.

During deletion only that row and dialog action are busy. The dialog cannot be
dismissed into a second request. Success closes it and refreshes the owning
scope. If `activeDeleted` is true, the Store clears active session identity but
preserves the selected project/projectless scope; the central view becomes the
existing no-session state. Inactive deletion leaves current runtime, transcript,
model, queue, and Composer state unchanged.

Runtime snapshots in `stopped`, `error`, or `crashed` state also clear active
session identity. This covers the active-delete failure case after Pi has
already stopped.

## Failure Matrix

| Condition | Result |
| --- | --- |
| Entry provenance is still loading | No completed response footer yet |
| Entry/message alignment fails | Copy remains; Fork is disabled with explanation |
| Fork is cancelled by an extension | Current session remains ready; no draft replacement |
| Fork changes session but hydration fails | Loading ends in typed error; no old transcript |
| Delete token is stale, replayed, or belongs to another scope | Reject before stop or filesystem mutation |
| Target path/header/identity changes | Reject as stale; do not delete replacement |
| Deleting inactive row | Delete target only; current Pi continues |
| Active target is streaming/compacting | Confirmed delete stops it through bounded host shutdown |
| Trash succeeds and target disappears | Return `disposition: 'trash'` |
| Trash fails or leaves target | Unlink and return `disposition: 'unlink'` |
| Trash and unlink both fail | Typed failure; catalog invalidated; stopped active view remains empty |

## Tests And Evidence

Pure renderer tests cover active-branch reconstruction, duplicate prompts,
abandoned branches, compaction, multi-message tool loops, deep histories,
streaming exclusion, exact copy Markdown, and Fork entry IDs.

Main tests inject trash/unlink behavior and cover one-shot tokens, scope/header
revalidation, symlink/file replacement, active canonical matching, inactive
deletion, bounded stop ordering, trash fallback, double failure, and duplicate
session IDs. IPC tests prove paths are rejected/absent.

Electron coverage verifies one response footer, clipboard payload, exact fake-Pi
Fork entry ID, removal of the picker/sidebar Fork item, Delete confirmation,
row loading, active view clearing, and scoped catalog refresh. Actual operating-
system trash behavior remains an injected Main unit test to avoid moving test
fixtures into the developer's real Trash.

## Rollback

Rollback is a code revert. No migration or compatibility reader is introduced.
Deleted files are recoverable only when the operating-system trash operation
succeeded; permanent fallback is intentionally the same behavior the user
approved from official Pi.
