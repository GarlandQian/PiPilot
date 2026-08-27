# Feasibility synthesis

## Decision

The selected production direction is:

`bundled Pi SDK 0.84.2 → Electron utilityProcess → Main-owned MessagePort →
PiPilot RPC projection → existing validated Renderer IPC/store`

Host scope is one canonical project/projectless cwd. Each Host has a retained
Runtime registry for activated conversations in that scope. Catalog listing is
independent from Runtime allocation, and concurrent/idle activated
conversations retain independent Runtime instances. Different project/cwd
values never share a Host.

## Feasible now

- Public Pi SDK runtime creation, Session replacement, fork/clone, resource
  loading, extension binding, models, settings, and SessionManager operations.
- Electron 43 utility process startup, ESM entry, transferable MessagePort,
  process lifecycle events, and packaged ASAR entry resolution.
- Main facade compatibility: current catalog, scope, hydration, generation,
  UI dialog, MCP, models, and package-management consumers can remain behind the
  existing host surface.
- MessagePort-native command/event projection using bounded plain DTOs and
  parity tests against the pinned official RPC oracle.

## Not guaranteed by Pi's public API

- Extension factory execution is not a one-time Host cost.
- Arbitrary plugins are not isolated across unrelated cwd values in one process.
- A single fixed RSS number or universally millisecond Runtime switch.
- Complete cleanup of extensions that retain process globals, timers, native
  handles, child processes, or servers after Runtime disposal.
- Reusing official `runRpcMode()` as a MessagePort dispatcher.

## Blocking feasibility gates before cutover

1. Packaged utility import and native/WASM/worker execution on macOS arm64/x64,
   Windows x64, and Linux x64.
2. Clone-safe DTO, bounded queue/credit, large-payload, port-close, crash, and
   shutdown tests.
3. Public-SDK Session lifecycle and project/projectless scope parity.
4. Command/event/extension-UI parity against exact Pi 0.84.2 RPC fixtures.
5. Representative plugin compatibility and disposal matrix.
6. Timings and RSS/heap/external-memory samples for cold host, Runtime creation,
   warm reuse, replacement, cross-cwd Host, and 1/4/8 Runtime comparison points.

Until these gates pass, the existing CLI backend remains a development/test
oracle only; it is not a silent production fallback after final cutover.
