# Current runtime migration summary

## Migration seam

Keep the public `LocalPiRuntimeHost` facade in Main. Replace only its child
process/JSONL internals with a utility-process MessagePort backend. This lets
conversation context, session catalog activation, workspace hydration, MCP,
models, package management, preload, IPC, and `PiRpcProvider` remain
backend-agnostic.

## Reuse

- `src/shared/local-pi.ts` owns Pi DTO schemas and should remain the shared
  validation owner.
- `src/main/local-pi/local-pi-ipc-response.ts` already projects deep trees
  iteratively for the Renderer.
- `src/main/ipc/register-local-pi-ipc.ts` owns Renderer-ready reconciliation,
  event ordering, and validated forwarding.
- `src/store/pi-rpc.tsx` and `src/renderer/pi-rpc/projector.ts` own generation,
  hydration, queue, extension UI, and presentation state.
- Main conversation/catalog services remain filesystem/scope authorities.

## Replace

- external executable discovery/capability probe after cutover;
- `child_process.spawn`, JSONL decoder/writer, stdio correlation, and CLI
  signal/shutdown;
- package-management identity based on an external executable.

## Add

- exact bundled SDK dependency and packaged utility entry;
- Main `PiHostController` with host epoch, MessagePort, request deadlines,
  bounded queues, crash/exit, and disposal;
- utility-side RuntimeManager and a per-project/cwd retained Runtime registry;
- versioned host envelopes and clone-safe projection;
- timing telemetry and bundled-SDK package-management restart fan-out.

## Lifecycle invariants

- `AgentSessionRuntime` replacement recreates cwd-bound services and requires
  re-subscription/re-binding; late events must be rejected by host epoch and
  Runtime generation.
- Project/cwd values never share a Host. A Host can own multiple same-cwd
  Runtime instances for concurrent conversations; activated idle sessions keep
  their own Runtime until explicit lifecycle disposal.
- Host crash invalidates all project Runtime instances, rejects pending work once,
  clears UI requests, and never replays accepted mutations or prompts.
- Extension UI requests need explicit opened/terminal states and a Host-owned
  deadline, including editor.

## Current lag decomposition

Measure separately: executable discovery, capability-probe process, CLI/Host
startup, SDK import, services/resource reload, extension module import, factory
activation, Session creation/bind, hydration, Renderer commit, and UI waiting.
The existing code can initialize Pi twice before the real conversation runtime.

## Tests and packaging

The migration requires a CLI parity oracle, deep-tree/large-payload tests,
clone rejection and MessagePort pressure tests, extension UI cancellation and
replacement tests, representative plugin compatibility tests, and packaged
macOS/Windows/Linux utility execution. No absolute latency or RSS budget is
valid before the benchmark records it.
