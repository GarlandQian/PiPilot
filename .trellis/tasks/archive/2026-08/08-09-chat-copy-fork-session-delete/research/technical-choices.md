# Technical Choices

## Repository Findings

- `MessageList` renders a flat `Turn[]`. One official assistant message can
  produce several text, thinking, and tool turns, and tool-result messages may
  follow before the next user message. A footer attached to every text fragment
  would therefore repeat controls and appear before the response is complete.
- `Turn` identifiers are renderer-generated from runtime generation, session
  ID, message index, and timestamp. They are not official Pi session entry IDs.
- The current sidebar fork flow activates a session, requests
  `get_fork_messages`, opens a message picker, and sends `fork { entryId }`.
  Successful fork responses already put Pi's returned text into the Composer
  draft and trigger authoritative session hydration.
- Sidebar rows carry opaque selection tokens. Session paths remain Main-only.
  The current catalog revalidates token scope, direct-file containment,
  canonical identity, header cwd, and session ID before opening a session.
- Existing copy affordances use `navigator.clipboard.writeText`; destructive
  confirmations use the shared Radix alert-dialog components; icons come from
  `react-icons/tb`.

## Official Pi 0.84.1 Findings

The installed official package was checked directly:

- `docs/rpc.md` defines `fork` as creating a new fork from a previous user
  message and requires that message's stable `entryId`.
- `get_entries` returns every append-only `SessionEntry` plus the current
  `leafId`. Each entry has a stable `id` and `parentId`; this is sufficient to
  reconstruct the active branch without matching message text.
- `get_messages` is compaction-aware context. Official
  `buildContextEntries()` follows the active leaf, keeps the latest compaction,
  applies `firstKeptEntryId`, and then converts message, custom-message,
  compaction, and branch-summary entries to context messages.
- `get_fork_messages` returns user entry IDs but scans append order. It does not
  carry assistant-response relationships, so it cannot safely annotate a
  response by matching text, especially with duplicate prompts or abandoned
  branches.
- RPC has no delete-session command. Pi's official interactive session selector
  confirms deletion, tries its `trash` integration first, verifies that the
  path disappeared, and falls back to `unlink`.
- Session entries are append-only and cannot be individually deleted. This task
  deletes only a complete session JSONL file selected from the catalog.

Authoritative local references:

- `@earendil-works/pi-coding-agent/docs/rpc.md`, sections `fork`,
  `get_fork_messages`, and `get_entries`.
- `dist/core/session-manager.js`, `buildContextEntries()` and
  `getUserMessagesForForking()`.
- `dist/modes/interactive/components/session-selector.js`, confirmed
  trash-first deletion flow.

## Chosen Response-Provenance Model

Hydrate official entries alongside messages. Reconstruct the leaf-to-root path
iteratively, apply Pi's documented compaction-aware context-entry selection,
and produce one origin record for every context message. Align origins and
`get_messages` by deterministic conversion order, never by text.

Projection groups content from one visible user message until the next visible
user message. After a settled group with non-empty assistant Markdown, append a
derived response-action turn containing:

```ts
{
  kind: 'response-actions'
  id: string
  copyMarkdown: string
  forkEntryId?: string
}
```

The action turn follows all text and tool-result turns in that response. Copy
remains available when Markdown exists. Fork is enabled only when the origin
alignment supplies the preceding official user entry ID. Streaming, aborted,
or failed responses do not expose a fork action.

Initial hydration reads all entries. Later settled refreshes use the last known
entry ID as `get_entries.since`, append new entries, and accept a changed
`leafId`; an unknown cursor retries one full entry hydration. Generation or
session replacement clears the entry snapshot. All asynchronous results retain
the existing generation/session/nonce guards.

## Chosen Deletion Boundary

Deletion is an explicit Main-owned lifecycle service, not an RPC invention and
not a renderer filesystem API.

1. Consume the opaque selection token once and run the catalog's existing
   scope/file/header validation.
2. Determine active ownership by canonical session-file identity and exact
   scope, never by session ID alone.
3. If active, stop the bounded owned Pi runtime before touching the file.
4. Revalidate canonical regular-file identity and the official header.
5. Call Electron `shell.trashItem`; if it throws or leaves the file present,
   fall back to `unlink`, matching official Pi interactive behavior.
6. Invalidate only the owning scope catalog and return a typed result containing
   `activeDeleted` and `disposition: 'trash' | 'unlink'`; never return a path.

Open/new/delete operations share the conversation lifecycle queue. A stale,
replayed, cross-scope, changed-identity, or already consumed token fails before
deletion. An inactive deletion never stops the current runtime. If active
deletion stops Pi but both removal methods fail, the stopped runtime remains
authoritative and renderer state must still clear rather than show stale data.

## Rejected Alternatives

- Match fork entries by prompt text: duplicate text and abandoned branches make
  this ambiguous.
- Put controls after every assistant text fragment: tool loops create multiple
  fragments within one response and place the controls too early.
- Expose a session path through IPC: violates the established Main-owned scope
  and catalog boundary.
- Invent a Pi `delete_session` RPC command: no such 0.84.1 command exists.
- Delete by session ID: duplicate IDs are admitted by the official catalog and
  cannot identify one file.
- Stop the runtime whenever the deleted row shares a session ID: can stop the
  wrong file when duplicate IDs exist.

## Verification Focus

- Duplicate prompt text, abandoned branches, compaction, tool loops, multiple
  assistant text parts, streaming settlement, and stale generation results.
- Copy payload excludes tool output, thinking, labels, and UI metadata.
- Exact fork entry ID reaches official RPC and successful fork hides old data
  until the new session is fully hydrated.
- Active versus inactive deletion, stale/cross-scope tokens, file replacement,
  trash success, trash fallback, double failure, duplicate session IDs, and
  catalog refresh isolation.
