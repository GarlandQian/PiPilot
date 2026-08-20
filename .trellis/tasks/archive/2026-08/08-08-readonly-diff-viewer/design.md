# Technical Design

## Read-Only Data Flow

```text
Inspector Diff tab
  -> workspace changes list/read API
  -> Main WorkspaceContentService
  -> bounded Git status + unified diff output
  -> WorkspaceDiffFile { metadata, patch, truncated }
  -> lazy @pierre/diffs React adapter
```

No arrow returns from renderer to mutate the workspace. The API surface includes
list, read, refresh/subscription only.

## Shared Contract

Keep canonical workspace-relative path, status, counts, binary flag, branch,
file list limit, patch byte limit, and truncation state. Replace parsed
`WorkspaceDiffLine[]`, fingerprint, custom source, and mutation result schemas
with a bounded unified-patch string and any old/new filename metadata required
by the installed public library types.

Content-change events retain only read-refresh causes that still exist (for
example filesystem/tool observation or explicit refresh). Remove `accept` and
`revert` reasons. If no reliable event source survives local Pi cutover, use the
existing explicit refresh plus bounded refresh on inspector activation rather
than inventing Agent patch events.

## Main Service Simplification

Preserve read-only Git commands for branch/status/numstat/unified patches,
timeouts, output limits, ignored performance-heavy directories, workspace
identity, and canonical containment. Support unstaged/untracked/deleted/renamed
states already shown by the current workflow.

Delete:

- tool patch map/record and patch parser used only by the hand table;
- file content fingerprints and absent fingerprints;
- accept/revert methods, expected-fingerprint checks, confirmation flow;
- mutation-only write/open flags, chmod, rename, symlink recreation, and reverse
  patch/application helpers;
- mutation result/event contracts and handlers.

Use Git's standard unified output as the renderer input. Truncate at a complete,
well-described boundary; never silently pass an unbounded patch through IPC.

## Renderer Adapter And Loading

Create a narrow `ReadOnlyPatchDiff` module that is dynamically imported by the
Diff tab. At implementation time, inspect `@pierre/diffs` installed types and
adapt PiPilot's patch, filename, theme, font, wrap, and line-number preferences
only through public props. Disable or omit annotation/review callbacks.

The surrounding `DiffViewer` renders one scroll container with a sticky header
for every file. It removes index/previous/next state. The lazy fallback has
fixed dimensions so loading cannot resize the inspector. A module or patch
parse failure renders a localized per-file error while keeping the remaining
files and refresh available.

Wrap the stack in the public React `Virtualizer` from `@pierre/diffs`; each
`PatchDiff` then uses the library's virtualized implementation. Keep list/read
state in `ElectronInspector` as a per-path `idle | queued | loading | ready |
error` map. Queue the first and observer-visible/prefetched sections through a
FIFO with at most three active reads. Increment an epoch on refresh/workspace
replacement and ignore all responses from older epochs. Do not eagerly retain
up to 200 patches at the 2 MiB per-file bound.

## Theme And Typography

Map PiPilot's resolved light/dark mode to a supported library theme. Apply the
same resolved monospace font stack and code font size where the public API
permits, and map existing `wordWrap`/`showLineNumbers` settings. Do not fork
library styles or patch its package assets.

## Verification

- Service fixtures for modified/new/deleted/renamed/binary/untracked, large
  patch, Git unavailable, timeout, traversal, and no write side effects.
- Contract/static checks proving mutation methods/fingerprints are absent.
- Component/controller fixtures for theme, wrap, line-number, continuous file
  order, bounded reads, stale-response rejection, independent loading/error/
  retry/empty/binary/truncated states, and no review controls.
- Build chunk inspection proves the Diff dependency is lazy.
- Electron screenshots at narrow/desktop inspector widths and light/dark modes.

## Rollback

Rollback is a commit revert. There is no compatibility mutation endpoint kept
behind the read-only UI; restoring accept/revert would require a separately
reviewed feature.
