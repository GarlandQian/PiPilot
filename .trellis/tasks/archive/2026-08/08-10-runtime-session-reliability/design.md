# Technical Design

## Current Baseline

`src/shared/local-pi.ts` already validates recursive tree nodes iteratively, but
the validated object remains recursive. `register-local-pi-ipc.ts` returns that
object directly. `OfficialPiSessionCatalog` already coalesces explicit refresh
calls, but `refreshFirstPage()` still gives lifecycle invalidation only two
attempts. `ElectronInspector` still mounts Files/Changes loaders whenever a
workspace exists.

## Renderer RPC Projection

Keep `LocalPiRuntimeHost.request()` and its exact official response type
unchanged. Add an IPC response projector adjacent to the validated handler. For
`get_tree`, walk roots with an explicit stack and emit stable preorder rows:

```ts
type LocalPiTreeRow = {
  entry: LocalPiSessionEntry
  parentId: string | null
  depth: number
  order: number
  label?: string
  labelTimestamp?: string
}
```

The shared preload/renderer success union substitutes `{ rows, leafId }` only
for `get_tree`; Main-internal host types retain `{ tree, leafId }`. Validate the
flat result and call `structuredClone()` in Main as a final deterministic probe
before returning. The Agent inspector renders rows directly and removes its
second recursive-tree flattening ownership.

## Refresh Coordinator

Replace `Map<scope, Promise>` plus fixed attempts with a coordinator per scope:

```ts
type RefreshCoordinator = {
  promise: Promise<SessionCatalogListResult>
  requestedVersion: number
  dirty: boolean
  queued: boolean
}
```

`invalidate()` increments the scope version, clears the cache, and marks an
active coordinator dirty. One loop scans, compares generations, and rescans
within explicit iteration and wall-time budgets. If still dirty at the
foreground limit, it retains loading/no cache and schedules exactly one queued
continuation. Ordinary churn is not converted to a global error. A genuine
scan error still rejects. Coordinator identity cleanup occurs in `finally` so a
later refresh can recover.

Renderer request IDs continue suppressing only superseded list calls. Opening a
selection never uses this suppression and retains strict one-shot/stale
behavior.

## Inspector Gate

`App` passes the authoritative `PiConversationPresentation` to Inspector.
`ElectronInspector` mounts session-owned tab controllers only when
`conversation.state === 'ready'`. Empty/loading/error branches render a shared
full-height centered state. Transitioning away from ready increments directory,
preview, and continuous-diff epochs and disposes Pi history/Shell request state.

Terminal content is split from session-owned tab content so an existing project
terminal remains mounted/available. Projectless behavior stays unavailable.

## Verification Shape

Unit tests cover flat projection bounds/order/labels, coordinator churn and
cleanup, stale action errors, and inspector readiness transitions. The fake Pi
emits a deep tree and a bounded activation event burst in Electron tests so the
actual structured-clone boundary is exercised.

## Rollback

The host protocol and session files are not migrated. The Main IPC projection,
catalog coordinator, and renderer flat-tree consumer are one contract rollback
unit. Inspector gating is an independent renderer rollback.
