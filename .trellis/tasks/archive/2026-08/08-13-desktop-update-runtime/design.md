# Design

## Ownership

- `ApplicationUpdateService` owns one current snapshot, timers, provider
  subscription, operation serialization, and disposal.
- Main-only provider adapters isolate electron-updater and GitHub response
  shapes from shared contracts.
- Shared Zod schemas own all cross-runtime DTOs; preload uses the existing
  validated invoke/subscription pattern.
- Renderer provider owns subscription/hydration only; it does not infer update
  capability or parse release data.

## State Flow

```text
provider event/result -> Main normalization -> revisioned snapshot
  -> validated IPC event -> preload parse -> renderer provider -> consumers
```

The snapshot is a discriminated union: disabled, idle, checking, current,
available, downloading, downloaded, and error. Available/error variants retain
the platform capability so UI actions remain deterministic.

## Provider Selection

Use `process.platform`, packaged state, and the actual packaged target marker.
Do not assume every Linux install is AppImage. The Windows native provider is
provisional until its isolated unsigned update gate passes; without that proof,
the NSIS package retains its Windows identity but uses the manual GitHub Release
checker without changing renderer types.

## Shutdown

Extract the current `before-quit` disposal sequence into an idempotent
coordinator. It accepts final intent `quit` or `install-update`, blocks duplicate
requests, disposes all current long-lived owners, and only then calls the final
Electron/updater action. Keep current deadlines inside the owning services.

## Testing Seams

Inject clock, provider, packaged/platform facts, and shutdown collaborators.
Unit tests must not access GitHub or install an update. Electron tests use a fake
provider through Main composition, not renderer mocks.
