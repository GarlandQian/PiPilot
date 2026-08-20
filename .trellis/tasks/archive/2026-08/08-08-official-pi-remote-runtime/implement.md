# Implementation Plan

## 1. Define Documented RPC Contracts

- Project only the official command/response/event/extension-UI fields consumed
  by PiPilot into shared Zod schemas.
- Define stable host status, diagnostics, and error contracts without copying
  upstream client classes or legacy Agent semantics.

## 2. Resolve And Probe Local Pi

- Add the explicit executable setting and Main resolver for supported platforms.
- Implement canonical path/version output and a short `get_state`/`get_commands`
  no-model latest-version capability probe.
- Surface missing/incompatible/ready status through existing app settings/about
  layout using the real Main snapshot. Replace disabled/fallback copy and remove
  the hard-coded bundled Pi runtime/About value.
- Wire executable choose/clear/re-probe plus real app version/platform/arch/
  Electron data; preserve loading and error states instead of fixture values.

## 3. Build Strict JSONL Transport

- Implement chunk buffering, LF-only split, optional CR stripping, bounded
  record parsing, serialized writes, request IDs, pending timers, and routing.
- Add the deterministic fake executable and cover fragmentation, Unicode line
  separators, malformed/unknown records, errors, timeouts, and backpressure.

## 4. Build Process Lifecycle

- Spawn `pi --mode rpc --approve` with cwd, environment, and optional session;
  assert that no `--session-dir` is supplied.
- Add generation-aware start/restart/replace/shutdown, pending/dialog
  cancellation, stderr bounds, and subscription cleanup.
- Expose validated IPC/preload methods and event subscriptions for later
  renderer integration.

## 5. Verify Local Resources And Packaging

- Exercise global/project fixture extensions, command discovery, extension
  errors, and official degraded TUI behavior.
- Build/package and prove an explicit executable path works without inherited
  version-manager PATH.

## Validation

After all edits for this child:

```bash
pnpm test:unit -- tests/unit/local-pi-jsonl.test.ts tests/unit/local-pi-runtime-host.test.ts tests/unit/ipc-contracts.test.ts
pnpm typecheck
pnpm build
pnpm package:dir
pnpm test:packaged -- --grep "local Pi RPC"
```

Run the no-model real local Pi smoke separately and report the selected path and
version without logging credentials or configuration contents.

## Handoff And Pre-Start Gate

This child hands the session catalog a resolved Agent/session environment and
hands renderer integration a typed command/event/UI host. It must not edit
renderer conversation state or inspect/migrate/delete old app data. Context
manifests must validate and the umbrella must receive final implementation
approval.
