# Read-Only Continuous Changes Contract

## 1. Scope / Trigger

Use this contract whenever the renderer lists workspace Git changes, loads
unified patches, or renders the Changes inspector. The feature is read-only:
Main owns bounded Git reads and the renderer owns only loading and presentation.

## 2. Signatures

```ts
type DiffReadPhase = 'idle' | 'queued' | 'loading' | 'ready' | 'error'

class ContinuousDiffController {
  beginListLoad(): number
  resolveList(epoch: number, result: WorkspaceDiffSnapshot): boolean
  rejectList(epoch: number, error: unknown): boolean
  request(paths: string | readonly string[]): void
  getSnapshot(): ContinuousDiffSnapshot
  subscribe(listener: () => void): () => void
}

workspace.changes.list(): Promise<WorkspaceDiffSnapshot>
workspace.changes.read(path: string): Promise<WorkspaceDiffFile>
```

## 3. Contracts

- Render every bounded file summary in source order inside one vertical scroll
  surface. Do not restore per-file previous/next navigation.
- Each file has an independent phase and stable path identity. Binary files are
  terminal `ready` summaries and do not request a text patch.
- Queue the initial three text files, then files entering the visible/prefetch
  region. The observer uses the Changes scroll root and a bounded nearby margin.
- Read jobs are FIFO with at most
  `CONTINUOUS_DIFF_MAX_CONCURRENT_READS === 3` active requests.
- `beginListLoad()` increments an epoch, clears the old queue/view, and makes
  every response from an older epoch inert. Validate that each detail response
  path equals the requested path.
- Wrap the entire stack in the public lazy `@pierre/diffs/react` `Virtualizer`;
  render each ready patch with the public `PatchDiff`. Keep this dependency out
  of the initial chat bundle.
- Loading, binary, oversized, truncated, empty-patch, renderer-load, and read
  failures are per-file states. One failure never blocks other files; retry
  requeues only that path.
- The renderer exposes no accept, revert, stage, edit, fingerprint, or mutation
  callback. Main continues canonical containment and bounded Git output.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| List request is pending | stable list loading state |
| List result is from an old epoch | ignore completely |
| Detail result path differs from requested path | per-file stale-workspace error |
| File is outside the observer window | remain `idle`; do not eagerly read |
| Three reads are active | keep later jobs `queued` in FIFO order |
| One detail read/render fails | inline error and retry for that file only |
| File is binary or oversized | explicit non-patch state; continue remaining files |
| Workspace/refresh changes identity | new epoch, clear old queue and results |
| List is truncated | show a list-level truncation notice without hiding returned files |

## 5. Good / Base / Bad Cases

- Good: 12 changed files appear immediately; the first three patches load, then
  nearby sections load as the user scrolls, all in one continuous view.
- Base: the working tree is empty or Git is unavailable. Show the corresponding
  stable state with refresh still available.
- Bad: `Promise.all()` up to 200 two-megabyte patches, one active index with
  previous/next buttons, a global dialog for one failed file, or any renderer
  callback that mutates the working tree.

## 6. Tests Required

- Controller unit tests assert source order, initial three requests, maximum
  concurrency three, FIFO draining, stale epoch rejection, path mismatch,
  binary bypass, independent error, and retry.
- Service/contract tests assert canonical containment, unified-patch byte bounds,
  Git unavailable/binary/renamed/deleted/untracked cases, and absence of write
  APIs or mutation fingerprints.
- Build inspection asserts a separate lazy Diff chunk. Electron coverage opens
  a multi-file repository, waits for the first patch, scrolls to the last file,
  and verifies that both remain in the same continuous Changes surface.

## 7. Wrong vs Correct

Wrong:

```ts
const patches = await Promise.all(snapshot.files.map(file => changes.read(file.path)))
setActiveDiffIndex(activeDiffIndex + 1)
```

Correct:

```ts
const epoch = controller.beginListLoad()
const list = await changes.list()
controller.resolveList(epoch, list)

observerVisiblePaths.forEach(path => controller.request(path))
// Controller runs a maximum of three FIFO reads and ignores prior epochs.
```
