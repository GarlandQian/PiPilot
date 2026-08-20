# Technical Design

## Submission Contract

Renderer-internal Composer data is:

```ts
interface ComposerSubmission {
  text: string
  images: RpcImageContent[]
  contextPaths: WorkspaceContextPath[]
}
```

This is not an Agent wire protocol. Immediately before the RPC boundary, the
renderer formats `text + context block` and passes only documented `message` and
`images`. Idle submission routes to `prompt`; while streaming the primary/
keyboard action routes to `follow_up`, and the explicit one-shot Steer action
routes to `steer`.

The formatter preserves typed text, inserts one blank-line separator when
needed, sorts chips by user selection order, and emits:

```text
Referenced workspace paths:
- `src/example.ts`
- `src/components/`
```

Canonical paths disallow newlines, backslashes, dot segments, and escapes. No
file content is read by the formatter.

## Image Ingestion

A visually hidden `<input type="file" multiple accept="image/png,image/jpeg,...">`
provides native chooser behavior. Click, paste, and drag/drop feed one helper:

1. identify browser MIME and supported current-Pi allowlist;
2. deduplicate by stable per-selection metadata/content identity sufficient for
   UI behavior;
3. enforce count/per-file/total decoded-byte limits before conversion;
4. create object-URL previews and immutable attachment records;
5. convert bytes to base64 without a data-URL prefix only when preparing the
   official command, or cache in memory while pending when needed for one send;
6. revoke URLs and release byte references on removal/success/replacement/
   unmount.

No raw attachment enters persisted React stores, Main persistence, logs, or
diagnostics. The selected official model's input metadata disables/substantiates
image support where available; Pi preflight remains authoritative.

## Workspace Path Search

Add a typed API such as `workspace.searchPaths(workspaceId, query)` returning up
to 100 `{ path, name, type }` rows. Main performs a bounded asynchronous walk of
the active workspace using the same canonical root/path resolver and ignored
performance-heavy directories as the file tree. It follows only symlink targets
that canonicalize inside the workspace.

Rank exact basename prefix, basename substring, then full path substring;
directories precede files for equal score, then stable locale/path order. Empty
query can show recent selections and root-level entries without a full scan.
Renderer debounces non-empty queries, cancels/ignores stale request IDs, and
keeps the picker responsive.

The former sensitive-name filter is not used. Search still excludes paths that
cannot be represented by the canonical relative-path schema and stops at count/
time/walk bounds.

## Composer State And Lifecycle

Attachment/context state is scoped to the current `{workspaceId, sessionId}`.
Text remains controlled by the Composer/extension editor contract. Changing
scope disposes previews and clears path selections; it does not persist draft
data across sessions in this task.

Submission sets a local preflight-pending flag. On official acceptance, clear
the submitted snapshot only if the live draft still matches it; this prevents a
user edit made while awaiting response from being erased. On error, retain all
valid live state and show the error. Disable duplicate sends but keep remove/
editing behavior coherent.

Streaming does not disable Composer editing. The renderer supplies Queue as the
default for every running submission, one-shot Steer, and separate Stop. This
task passes one immutable text/images/context snapshot through the selected
action and never stores a sticky action choice or a second attachment queue.

## UI

- Paperclip remains an icon button with tooltip; selected images appear above
  the input as compact preview chips.
- `@` opens an anchored command-style picker with search input, file/folder icon,
  canonical path, loading/empty/error rows, arrow-key navigation, Enter select,
  and Escape close.
- Context chips use file/folder icon and remove command; long paths truncate with
  full tooltip.
- Errors appear adjacent to selections and do not resize the composer
  unpredictably.
- The renderer-owned running Queue/Steer/Stop controls remain stable while image
  previews and context chips grow, shrink, or fail validation.

## Verification

- Image helper: MIME, byte/count totals, dedupe, base64 shape, object URL
  lifecycle, paste/drop/chooser, and unsupported model/preflight failure.
- Path search: ranking, bounds, cancellation, generated dirs, canonical paths,
  in-workspace symlinks, outside escapes, and formerly sensitive names visible.
- Formatter: empty/text-only/context-only, ordering, path escaping, one block.
- Submission: idle Prompt, running default Queue, one-shot Steer exact envelopes,
  pending duplicate block, successful snapshot clear, concurrent edit
  preservation, failure retention, and session/workspace cleanup.
- Electron: native chooser fixture plus paste/keyboard picker and no-plugin core.

## Rollback

The feature adds no persistent attachment/context data, so rollback removes the
UI/contracts without data migration. Workspace search is deleted only after all
callers are gone.
