# Continuous Changes View Research

## Confirmed Product Direction

The Diff tab is a read-only Changes view: every changed file is presented in
one vertically scrolling surface. Previous/next file navigation is removed.
File headers, status, and `+/-` counts are available immediately while patch
details load independently.

## Installed Library Contract

`@pierre/diffs@1.3.5` exports `Virtualizer` and `PatchDiff` from its public
`@pierre/diffs/react` entry. A `PatchDiff` below the React `Virtualizer`
context uses the library's `VirtualizedFileDiff`; `MultiFileDiff` represents
one old/new file pair and is not an all-patches list. The continuous surface
therefore wraps the stack of existing read-only `PatchDiff` instances in one
public `Virtualizer`.

## Renderer State

Keep the state local to `ElectronInspector`; it does not belong in the global
workspace store. Each summary is projected into an item with one of these
states:

```text
idle -> queued -> loading -> ready
                         -> error -> queued (retry)
```

`ready` carries the bounded patch and truncation metadata. Binary summaries
can render their stable state without reading a patch. A list epoch invalidates
late list/read results after refresh or workspace replacement.

The renderer owns a FIFO read queue with a maximum of three active
`changes.read` calls. An `IntersectionObserver` rooted at the single scroll
surface queues visible sections plus a bounded root-margin prefetch window.
The first few files are queued on mount so useful content appears even before
the observer reports. Do not use `Promise.all` over the full list: 200 files at
the existing 2 MiB per-file cap could otherwise retain roughly 400 MiB.

## Component Contract

`DiffViewer` receives the item list, list loading/truncation state, refresh,
per-path request, and per-path retry callbacks. It renders one scroll container
with a sticky header and fixed loading/error/binary/oversized/empty/truncated
state for every file. A failure in one file or one `PatchDiff` error boundary
must not block the remaining files or open the inspector-wide error dialog.

The lazily imported read-only renderer module exports the virtualized surface
and patch component so Shiki and the Diff renderer remain outside the initial
chat bundle.

## Affected Files

- `src/components/inspector/InspectorPanel.tsx`
- `src/components/inspector/DiffViewer.tsx`
- `src/components/inspector/ReadOnlyPatchDiff.tsx`
- `src/i18n/locales/en-US.json`
- `src/i18n/locales/zh-CN.json`
- focused renderer/controller tests

No Main, IPC, preload, or workspace Diff contract changes are needed; the
current list limit (200) and patch limit (2 MiB) remain authoritative.

## Verification Matrix

- all file headers appear in source order in one scroll surface;
- first/visible files queue and no more than three reads run concurrently;
- refresh invalidates late prior-epoch reads;
- one read/render failure leaves other files usable and supports retry;
- binary, oversized, empty, partial/truncated, list-truncated, loading, clean,
  and Git-unavailable states are independent and stable;
- no previous/next or mutation actions remain;
- the Diff renderer is still emitted as a lazy build chunk.
