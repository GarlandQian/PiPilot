# Research: Current Runtime Migration Feasibility

- Query: Map PiPilot's current LocalPi runtime, IPC, renderer projection, catalog, extension UI, and package-management lifecycles; determine the exact migration surface for a bundled Pi SDK utility host using Electron `utilityProcess` and `MessagePort`.
- Scope: mixed
- Date: 2026-08-14

## Findings

### Executive conclusion

The requested architecture is feasible, but it is not a transport-only replacement and it should not begin by deleting the current CLI backend. The smallest reliable migration seam is to preserve the public behavior of `LocalPiRuntimeHost` in Main and replace its process/JSONL internals with a utility-process controller. This keeps the renderer store, preload API, IPC channels, catalog activation, conversation context, most shared schemas, and existing event projection intact while the new host reaches parity.

The proposed “rewrite roughly 650 lines of RPC projection” is directionally correct only if it means reproducing the semantics currently hidden inside Pi's compiled RPC mode. It is false if it means rewriting PiPilot's renderer projector or placing 650 lines in one new projection file. Pi's installed `dist/modes/rpc/rpc-mode.js` is 653 compiled lines, but approximately 500 lines are command dispatch, extension UI request handling, runtime re-binding, and event adaptation. The JSONL/stdin/stdout/process-signal portion is replaced by `MessagePort`; PiPilot's own validated DTOs and renderer projector remain valuable and largely reusable.

The lag cannot yet be attributed solely to plugin discovery. The current initial path can initialize Pi twice: executable capability probing starts and disposes a full RPC process, then conversation reconciliation starts the real runtime. Pi also recreates runtime services and runs extension factories on `newSession`, `switchSession`, and fork replacement. A benchmark must separate OS process startup, utility-host cold import, resource discovery, extension module import, extension factory activation, session construction, hydration commands, renderer work, and UI-request waiting.

For arbitrary third-party plugins, one global utility process serving unrelated project working directories is not a safe initial topology. Pi's extension cache is process-global and cwd-sensitive, while plugin modules may also keep process globals, timers, child processes, and singleton state. The recommended first production topology is one utility host per selected project/cwd, initially with one active Pi runtime per host. Multiple same-cwd runtimes can be enabled later only after representative plugin isolation and resource benchmarks pass.

### Current lifecycle map

| Layer | Current behavior | Migration implication |
| --- | --- | --- |
| Main composition | Main creates one primary `LocalPiRuntimeHost` plus one `LocalPiRuntimePool`; the primary host is injected into conversation activation, context, MCP, models, and integrations (`src/main/index.ts:189-260`, `src/main/index.ts:310-410`). | Keep a Main-owned host facade. Replace its backend, not every consumer. |
| Primary runtime | `LocalPiRuntimeHost` serializes lifecycle operations, owns generation/request correlation, publishes snapshots/events/UI requests, and starts `pi --mode rpc --approve` with optional session/fork arguments (`src/main/local-pi/local-pi-runtime-host.ts:166-233`, `src/main/local-pi/local-pi-runtime-host.ts:235-545`). | These lifecycle semantics are the compatibility contract for the new controller. Process spawning and JSONL are the replaceable portion. |
| Process transport | The host decodes newline-delimited JSON, correlates responses, applies events, bounds stderr diagnostics, and performs bounded shutdown (`src/main/local-pi/local-pi-runtime-host.ts:568-915`; `src/main/local-pi/local-pi-jsonl.ts`). | Replace JSONL reader/writer and child-process shutdown with a validated MessagePort protocol, host epoch, utility exit handling, and port closure. |
| Runtime pool | Each pool entry creates its own `LocalPiRuntimeHost`, owns a session-file lease, and routes by `runtimeId` and generation (`src/main/local-pi/local-pi-runtime-pool.ts:1-408`). | Current pool semantics can inform IDs/leases, but the pool is not the renderer's active multi-runtime path today. Do not assume existing UI already exercises it. |
| IPC | Main validates commands, forwards primary/pool snapshots and events, and orders `agent_settled` observation before later events (`src/main/local-pi/register-local-pi-ipc.ts:77-117`, `src/main/local-pi/register-local-pi-ipc.ts:136-224`, `src/main/local-pi/register-local-pi-ipc.ts:226-385`). | Leave renderer-facing IPC stable during migration. The MessagePort belongs between Main and utility host, not between renderer and utility. |
| Preload/API | Preload validates inbound envelopes and exposes the typed `localPi.runtime` and `localPi.pool` API (`src/preload/index.ts:154-202`, `src/preload/index.ts:267-295`; `src/shared/pipilot-api.ts:120-149`). | Reusable without a renderer transport rewrite if Main preserves current contracts. |
| Shared DTOs | Commands, responses, iterative session-tree parsing, events, extension UI, snapshots, and runtime envelopes are centralized in `src/shared/local-pi.ts` (`src/shared/local-pi.ts:427-471`, `src/shared/local-pi.ts:533-664`, `src/shared/local-pi.ts:701-813`, `src/shared/local-pi.ts:823-1011`). | Reuse as the compatibility schema and add a host-internal protocol rather than duplicating renderer DTOs. Update version-specific drift before pinning the SDK. |
| Main response projection | Recursive Pi trees are converted to renderer-safe iterative DTOs (`src/main/local-pi/local-pi-ipc-response.ts:26-83`). | Reuse. This already protects the renderer from deeply nested official trees. |
| Renderer store | `PiRpcProvider` owns generation resets, loading/hydration, transcript, models, commands, stats, queue, extension dialogs, notifications, widgets, and official event projection (`src/store/pi-rpc.tsx:361-418`, `src/store/pi-rpc.tsx:512-770`, `src/store/pi-rpc.tsx:907-1088`). | Reuse. There is no existing `src/renderer/adapters/local-pi-adapter.ts`; the design must not depend on replacing a nonexistent adapter. |
| Session activation | Main confirms catalog selections, starts/replaces the runtime, tracks active scope by generation, observes the session directory, and invalidates catalog data on relevant commands/events (`src/main/conversations/official-pi-session-activation-service.ts:90-202`, `src/main/conversations/official-pi-session-activation-service.ts:221-400`). | Keep catalog/session selection Main-owned and replace only the runtime backend. Preserve confirmed file/header and scope checks. |
| New/open conversation | Same-scope ready runtime uses `new_session`; cross-scope starts a runtime; catalog open replaces with the selected file (`src/main/conversations/conversation-context-service.ts:85-153`). | SDK replacement must match these semantics and expose the resulting real session path before catalog confirmation. |
| Workspace UI | Session selection waits for Main activation and independently hydrates transcript/context (`src/store/workspace.tsx:522-568`, `src/store/workspace.tsx:595-617`, `src/store/workspace.tsx:743-779`). | Preserve generation/scope ordering so stale session content cannot appear during a backend restart. |
| Extension UI | Renderer queues extension UI requests and sends responses through IPC (`src/store/pi-rpc.tsx:987-1042`, `src/store/pi-rpc.tsx:1097-1150`); the dialog close path sends `{ cancelled: true }` (`src/components/chat/ExtensionUiDialog.tsx:30-61`). | A cancel path already exists. The missing contract is authoritative expiry/closure when the host times out, aborts, switches runtime, or crashes. |
| MCP/models | Controllers depend on the host facade for snapshot/restart/subscriptions rather than raw process details (`src/main/local-pi-management/mcp-config-service.ts:226-310`; `src/main/local-pi-management/models-config-service.ts:283-420`). | Reusable if the new facade retains restart and readiness behavior. |
| Package management | Integration operations capture selected executable identity, locate its exact importable Pi package, run an isolated helper against that package, and restart the primary runtime after mutation (`src/main/local-pi-management/local-pi-integration-service.ts:260-428`, `src/main/local-pi-management/local-pi-integration-service.ts:527-623`; `src/main/pi-management-helper.ts:493-520`). | The helper isolation pattern is reusable, but executable/package-location identity is not. A bundled SDK needs bundled module/version identity and restart fan-out by affected scope. |

### Exact reusable and replacement surface

#### Reuse unchanged or with narrow version updates

- Renderer-facing `PiPilotApi`, preload exposure, IPC channel structure, and `PiRpcProvider` actions/state.
- Current `LocalPiRuntimeHost` public methods and listener semantics as the Main-side facade: start, replace, restart, stop, request, UI response, snapshot/event/UI subscriptions, and generation invalidation.
- Shared command/response/event/runtime schemas and Main tree projection. The event schema needs a Pi 0.84.2 compatibility update described below.
- Renderer projector and deep-tree protections.
- Catalog observation, opaque catalog selection, session activation confirmation, conversation context, and workspace loading state.
- Main event ordering, correlation, diagnostics concepts, and pending-request rejection on generation change.
- MCP/models controllers that consume host readiness and restart behavior.
- The concept of an isolated package-management helper, provided it imports the bundled version rather than discovering a user installation.

#### Replace

- `child_process.spawn` of an externally selected `pi` executable.
- JSONL decoder/writer, stdin/stdout command transport, process stderr as the primary timing channel, and CLI signal/shutdown behavior.
- Executable-path target identity and version/capability probe as prerequisites for chat.
- Package locator/importability checks that require an executable to map to an external Node package.
- Integration restart logic that assumes only the primary runtime needs restarting.
- Settings and copy that present external Pi executable selection as the runtime source, once the bundled backend becomes the only production backend.

#### Add

- A production-pinned Pi SDK dependency and an Electron Vite utility-process entry included in packaged output.
- A Main `PiHostController` implementing the existing host facade and owning utility spawn, a `MessageChannelMain`, host epoch, crash recovery, and runtime routing.
- A utility-side `RuntimeManager` and one runtime adapter per active runtime.
- A host protocol containing at least `hostEpoch`, `runtimeId`, `runtimeGeneration`, `requestId`, message kind, payload, and structured error.
- Explicit utility events for UI request opened, resolved, cancelled, expired, and invalidated by runtime replacement.
- Structured timing telemetry for host import, service creation, resource reload, extension activation, session creation, bind, and hydration commands.
- A restart coordinator that maps global versus project package/config changes to all affected hosts.

### The 650-line RPC rewrite assumption

The installed Pi 0.84.2 `dist/modes/rpc/rpc-mode.js` is 653 compiled JavaScript lines. Its responsibilities are approximately:

- Extension UI context and pending requests: lines 40-224, about 185 lines.
- Runtime rebind and event subscription: lines 225-274, about 50 lines.
- RPC command dispatch: lines 291-572, about 282 lines.
- JSONL transport, stdin/stdout, signals, and process shutdown: lines 23-39, 275-290, and 573-653, about 136 lines.

Consequences:

1. Reusing `runRpcMode()` is not a valid MessagePort design. It takes over process stdin/stdout, installs process handlers, calls `process.exit`, and does not expose per-runtime routing.
2. The command handler and UI context are private closures. Pi does not expose a public “dispatch this RPC command against this runtime” API.
3. `toJsonEvent` is also private, but its semantic transformation is small: for `message_update`, omit the streaming `partial` object and retain cumulative usage plus the assistant event.
4. About 500 compiled lines of semantic behavior need to be reimplemented or generated from a command table, but the transport-specific 136 lines do not.
5. PiPilot's renderer projector is not the rewrite target. It remains the stable consumer-side projection.
6. A single 650-line handwritten switch would be fragile. Split responsibilities into command mapping, event conversion, extension UI bridge, runtime binding, and host transport, with parity tests derived from the official RPC contract.

### Version contract that must be resolved first

The repository currently declares `SUPPORTED_PI_VERSION = "0.84.1"` (`src/shared/local-pi.ts:3`), while the selected local package and npm latest are Pi 0.84.2 as of 2026-08-14. Pi 0.84.2 changed `message_update` to include top-level cumulative `usage`. PiPilot's strict schema currently accepts only `type` and `assistantMessageEvent` (`src/shared/local-pi.ts:866-892`), and the renderer projector ignores top-level usage (`src/renderer/pi-rpc/projector.ts:398-419`).

Before pinning 0.84.2, the schema must accept and validate `usage`. The UI may continue ignoring it initially, but rejecting an official 0.84.2 event would make the bundled runtime fail at its own validation boundary. Pin the production dependency exactly, for example `"@earendil-works/pi-coding-agent": "0.84.2"`, rather than with a caret, because the custom adapter is version-coupled to the official command/event contract.

### Multiple runtimes, session switching, catalog scope, and plugin state

Pi's public SDK supports multiple runtime objects, but that does not prove arbitrary plugins are isolated within one Node process:

- `createAgentSessionServices` creates cwd-bound settings, model runtime, package/resource loader, and calls `resourceLoader.reload()` for each new runtime (`dist/core/agent-session-services.js:53-107`).
- The extension module cache is process-global and associated with one cwd. Cross-cwd loading clears it (`dist/core/resource-loader/loader.js:113-127`).
- A cached module only avoids re-import. The extension factory is executed for each load/runtime (`dist/core/resource-loader/loader.js:351-410`, `dist/core/resource-loader/loader.js:432-459`).
- `AgentSessionRuntime.newSession`, `switchSession`, and fork replacement dispose the current session and invoke the stored runtime factory again (`dist/core/agent-session-runtime.js:102-249`). The official SDK documentation also requires re-subscribing and re-binding extensions after replacement (`docs/sdk.md:153-178`).

Therefore:

- Keeping the utility OS process alive removes OS startup and SDK module import from repeated switches, but it does not eliminate settings/resource reload or extension factory activation.
- One global utility process for all projects creates risks from process-global module state, `process.cwd`, environment mutations, singleton clients, timers, child processes, and plugins that were only tested in a single CLI process.
- The first production topology should be one host per selected workspace/cwd and one active runtime per host. This matches the current product's primary active-session model and bounds plugin contamination.
- Current `LocalPiRuntimePool` leases session paths and supports multiple processes, but the renderer does not currently invoke `localPi.pool`; it should not be treated as proof that concurrent runtime UX is complete.
- If later enabling multiple same-cwd runtimes in one utility host, each must have independent runtime generation, UI request namespace, subscriptions, session lease, and disposal, and representative plugins must pass concurrency tests.
- Catalog data remains Main-owned and filesystem-backed. A utility runtime should report the authoritative session path/header; Main should continue observing that path and validating scope before publishing activation.
- A utility-process crash invalidates every runtime in that host. Increment `hostEpoch`, reject all pending commands/UI requests, mark every runtime crashed, and recreate only through explicit lifecycle reconciliation.

### Extension UI liveness

The task's assumption that extension dialogs have no cancellation path is false: dialog close already sends `{ cancelled: true }` (`src/components/chat/ExtensionUiDialog.tsx:48-61`). The official Pi RPC implementation also supports timeout or `AbortSignal` for select/confirm/input, while editor requests lack the same timeout path.

The real gap is distributed ownership of completion:

- The renderer dequeues a dialog only after the response IPC call succeeds (`src/store/pi-rpc.tsx:1123-1150`).
- Pi can time out or abort the request internally without a corresponding “request closed” event reaching the renderer.
- A runtime switch, utility crash, or stale generation can make a late renderer response fail while leaving the visual request queued.

The new bridge should let the utility host own the request deadline and emit an explicit terminal event. Main must correlate it by host epoch/runtime generation/request ID. Renderer dismissal should be idempotent, and a failed late response must not keep a stale dialog visible.

### Package management and bundled ownership

The current package lifecycle is coupled to an external executable:

1. Resolve selected executable and version.
2. Locate the matching importable `@earendil-works/pi-coding-agent` package.
3. Launch an isolated helper with executable/package-root/module-entry/version identity.
4. Use public `SettingsManager` and `DefaultPackageManager` against the target scope.
5. Mark a restart requirement and restart the primary runtime.

With a bundled SDK:

- Retain the isolated helper because package operations can execute package-manager and third-party code and should not block or poison the active host.
- Build the helper against the same exact bundled Pi version and pass `{ sdkVersion, moduleEntry, cwd, scope }`, not a discovered executable path.
- Preserve global and project settings locations defined by official Pi APIs rather than inventing a PiPilot package format.
- A global package mutation must restart every active workspace host; a project package mutation should restart only the matching cwd host.
- Retry/reconciliation identity should compare bundled SDK version plus scope/cwd, not a transient executable path.
- External executable discovery and the package-importability error state become obsolete for the bundled production runtime. Keeping those settings while claiming a bundled-only architecture would create two conflicting sources of truth.

### Where the measured lag may come from

Do not accept the current “2.3 seconds once, then milliseconds” claim until it is measured against the real plugin set. The current path contains these independently measurable stages:

1. Executable resolution and `--version` probing.
2. A full RPC capability probe. `rendererReady` refreshes executable state, and the configured capability probe calls `probeLocalPiRpc`, which starts and disposes a Pi process before conversation reconciliation starts the actual runtime (`src/main/local-pi/register-local-pi-ipc.ts:77-117`; `src/main/index.ts:342-350`).
3. OS process startup and Pi CLI/module loading.
4. Settings/model runtime construction.
5. Package resolution and resource discovery.
6. Extension module import.
7. Extension factory execution and provider/tool/command registration.
8. Agent session creation, extension binding, `session_start`, and resource discovery events.
9. Renderer hydration requests: state, messages, models, thinking level, commands, stats, and entries (`src/store/pi-rpc.tsx:660-770`).
10. React projection/rendering of the hydrated transcript.
11. Extension UI waiting, which is an operational pause rather than runtime startup lag.

The bundled utility architecture is expected to remove repeated OS startup and repeated SDK module import. It may also remove the current double-initialization capability probe. It does not automatically remove per-runtime resource reload or extension factory activation.

### Smallest feasibility spike

Keep the current CLI backend as the production path during the spike.

1. Add an exact Pi SDK production dependency and a dedicated Electron Vite utility entry; package it in `out/main`.
2. Add a Main-only, test/dev-gated controller that launches `utilityProcess`, creates a `MessageChannelMain`, sends one port to the utility child, and verifies ping/pong, structured errors, port closure, utility crash, and bounded disposal.
3. In the utility child, import the public Pi SDK and create one persisted, no-extension runtime for one fixed fixture cwd.
4. Implement only: runtime create, `get_state`, `get_messages`, `get_commands`, one session replacement operation, event subscription, and dispose. Add the minimum extension UI request envelope but do not expose it as a product feature yet.
5. Compare the returned DTOs against the existing CLI backend for the same sanitized fixture.
6. Run the spike both unpacked and packaged on macOS, Windows, and Linux. Confirm the utility entry, ESM import, Pi transitive assets, optional/native dependencies, and any wasm files work from ASAR packaging.
7. Then run a real-extension benchmark using sanitized copies or deterministic fixtures for representative extension classes such as MCP, subagents, retry, and presentation/UI plugins. Do not use the developer's live credentials, MCP files, or sessions.

The spike succeeds only if it proves packaged import, MessagePort transport, official event parity for the selected commands, deterministic disposal, and a measurable reduction in repeated startup cost. A source-only prototype is insufficient.

### Benchmark design

Record both wall-clock latency and memory. Use the same machine, Pi version, cwd, settings fixture, session size, and plugin set for CLI and utility variants. Run warmups separately from recorded iterations and retain raw samples rather than only averages.

#### Timing marks

- Main request received.
- Utility process spawned.
- Port accepted and host ready.
- SDK root module import complete.
- Runtime services create start/end.
- Resource reload start/end.
- Per-extension module import and factory start/end.
- Agent session creation complete.
- Extensions bound and runtime ready.
- First state/event available.
- Hydration command batch complete.
- Renderer ready state committed.

#### Scenarios

- Existing CLI cold first activation, including current capability probe.
- Existing CLI direct activation with capability probe disabled in the benchmark harness.
- Utility host cold boot with no extensions.
- Utility host cold boot with the representative plugin set.
- First runtime in an already-running host.
- Second runtime in the same cwd.
- Session switch/new/fork within the same runtime owner.
- Runtime for a different cwd.
- Host crash and explicit recovery.
- UI request response, cancel, timeout, late response, and runtime replacement.

#### Metrics

- p50, p95, and maximum latency per stage over enough repeated samples to expose variance.
- Resident set size, heap used, external memory, and child/utility count after each lifecycle transition.
- Extension factory count per activation and whether module import was cached.
- Event/response parity failures and stale-generation drops.
- Disposal time and leaked handles/timers/child processes.

Set final performance budgets only after measuring the current baseline. The task's existing absolute latency and memory numbers should be treated as hypotheses, not acceptance criteria.

### Rollback seam

Introduce an internal Main-side backend interface matching the current `LocalPiRuntimeHost` facade. During migration:

- `CliJsonlRuntimeBackend` wraps the existing implementation.
- `EmbeddedUtilityRuntimeBackend` wraps the new controller.
- Backend selection is available only through a development/test flag while parity is incomplete.
- Renderer, preload, IPC, catalog, and controllers receive the same facade and are unaware of backend choice.
- Production remains on the CLI backend until the packaged parity and plugin matrix passes, then switches once to embedded.
- After acceptance, remove the CLI backend and executable settings. Do not retain a silent production fallback, because it would hide packaged regressions and reintroduce two runtime sources of truth.

The rollback unit is the backend implementation, not individual RPC commands. Host epoch and runtime generation must be part of both implementations so switching does not weaken stale-response protection.

### Phased delivery

1. **Contract correction** — reconcile task contradictions, choose exact bundled Pi version, update the official 0.84.2 event contract, and define the Main/utility protocol.
2. **Feasibility and packaging spike** — prove utility ESM import, MessagePort lifecycle, SDK runtime creation, packaged assets, timing, and deterministic disposal without changing production behavior.
3. **Backend seam and controller** — extract the current public host facade, add host epoch/runtime routing, and run CLI/embedded backends behind a dev/test selector.
4. **Single-workspace SDK runtime** — implement one cwd/one active runtime, authoritative session-path reporting, replacement, event binding, and crash invalidation.
5. **RPC semantic parity** — implement command mapping, event conversion, UI bridge, runtime rebind, deep-tree projection, and official parity tests.
6. **Primary product integration** — connect official session activation, conversation context, catalog observation, hydration, MCP, and models through the embedded backend.
7. **Extension UI liveness** — add host-owned timeout/cancel/expired semantics and idempotent renderer cleanup.
8. **Bundled package management** — migrate helper identity to the bundled SDK and implement global/project restart fan-out.
9. **Plugin topology decision** — benchmark representative plugins; ship one host per cwd unless same-process concurrency is proven safe.
10. **CLI removal and cleanup** — remove external executable discovery, capability probing, JSONL transport, dead settings/UI, and the development rollback backend only after packaged cross-platform acceptance.

### Test matrix

#### Protocol and unit

- Structured-clone-safe host messages and Zod validation.
- Host epoch, runtime generation, request correlation, duplicate/late responses, timeout, and port closure.
- Pi 0.84.2 `message_update.usage` conversion.
- All supported commands, errors, unknown commands, and cancellation.
- Iterative deep session trees and large transcripts.
- UI request opened/resolved/cancelled/expired/replaced behavior.

#### Runtime lifecycle

- Start, ready, stop, restart, new, switch, fork, clone, and cwd override.
- Replacement with pending command and pending UI request.
- Utility crash, Main shutdown, utility disposal timeout, and leaked-handle detection.
- Same-cwd sequential runtime and, if enabled, concurrent runtimes.
- Cross-cwd host isolation.

#### Session and catalog

- One-click opaque catalog selection.
- Authoritative session path/header confirmation.
- Projectless versus selected-project scope.
- Catalog directory observation and invalidation after session commands/events.
- `agent_settled` observation ordering.
- Scope mismatch, deleted session file, and stale generation.

#### Plugin compatibility

- No plugins.
- Representative command/tool plugin.
- MCP plugin with sanitized deterministic server.
- Subagent plugin.
- Retry/goal/plan-style event or command plugin.
- Extension UI plugin for select/confirm/input/editor/notify/status/widget.
- Plugin with timers or child processes to verify disposal.
- Same plugin in two same-cwd runtimes and two different cwd hosts.

#### Integrations

- Global and project package install/remove/update.
- Resource reload and correct host restart fan-out.
- Retry/reconciliation after host generation changes.
- MCP and models config restart behavior.
- No dependency on an externally importable Pi installation.

#### Renderer/Electron

- Loading covers conversation and inspector with no stale-data flash.
- Hydration success/failure after first selection and after restart.
- Extension dialog close, timeout, late response, and host crash.
- Commands, skills, models, stats, notifications, and extension widgets retain parity.
- Packaged macOS, Windows, and Linux builds launch the utility entry and resolve all Pi dependencies/assets.
- Windows executable/path behavior is irrelevant to chat after migration, but package/config paths and utility child startup must be tested explicitly.

## Files Found

- `src/main/local-pi/local-pi-runtime-host.ts` — current single-runtime CLI/JSONL lifecycle and compatibility facade.
- `src/main/local-pi/local-pi-runtime-pool.ts` — dormant renderer-side multi-runtime pool using one CLI process per entry.
- `src/main/local-pi/register-local-pi-ipc.ts` — renderer-ready reconciliation, IPC validation, event ordering, and pool routing.
- `src/main/local-pi/local-pi-ipc-response.ts` — renderer-safe iterative response projection.
- `src/main/local-pi/local-pi-jsonl.ts` — replaceable newline transport.
- `src/shared/local-pi.ts` — central Pi RPC, event, tree, UI, and runtime schemas.
- `src/shared/pipilot-api.ts` — renderer-facing typed API boundary.
- `src/preload/index.ts` — validated IPC exposure.
- `src/store/pi-rpc.tsx` — renderer runtime projection, hydration, loading, and extension UI queue.
- `src/renderer/pi-rpc/projector.ts` — official event-to-renderer projection retained by the migration.
- `src/components/chat/ExtensionUiDialog.tsx` — existing dialog cancellation behavior.
- `src/main/conversations/official-pi-session-activation-service.ts` — Main-owned session activation and catalog observation.
- `src/main/conversations/conversation-context-service.ts` — new/open/same-scope runtime decisions.
- `src/store/workspace.tsx` — session selection and transcript hydration state.
- `src/main/local-pi-management/local-pi-integration-service.ts` — current executable-coupled package-management lifecycle.
- `src/main/pi-management-helper.ts` — isolated official Pi package management helper.
- `src/main/local-pi-management/mcp-config-service.ts` — host-facade MCP restart integration.
- `src/main/local-pi-management/models-config-service.ts` — host-facade model restart integration.
- `src/main/index.ts` — primary host/pool composition and full RPC capability probe.
- `electron.vite.config.ts` — current Main build entries; utility entry is not yet configured.
- `electron-builder.yml` — current packaged file and ASAR-unpack rules.
- `package.json` — current dependencies; Pi SDK is not bundled yet.
- `.trellis/tasks/08-14-pi-plugin-lag-refactor/prd.md` — chosen embedded-SDK direction and current scope contradiction.
- `.trellis/tasks/08-14-pi-plugin-lag-refactor/design.md` — proposed host/controller/runtime design and rewrite estimate.
- `.trellis/tasks/08-14-pi-plugin-lag-refactor/implement.md` — proposed implementation phases, including the nonexistent renderer adapter assumption.

## External References

- Pi SDK guide in installed 0.84.2 package: `node_modules/@earendil-works/pi-coding-agent/docs/sdk.md` — public desktop/custom UI usage and session replacement/rebind requirements.
- Pi RPC guide in installed 0.84.2 package: `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md` — official command, event, and extension UI wire behavior.
- Pi RPC implementation: `node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js` — exact private semantic surface currently coupled to JSONL.
- Pi session services: `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session-services.js` — per-runtime settings/model/resource creation and reload.
- Pi resource loader: `node_modules/@earendil-works/pi-coding-agent/dist/core/resource-loader/loader.js` — process-global cwd-sensitive extension module cache and per-runtime factory execution.
- Pi session runtime: `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session-runtime.js` — service recreation on session replacement.
- Pi package manifest/changelog: `node_modules/@earendil-works/pi-coding-agent/package.json`, `node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md` — public exports, Node requirement, dependencies, and 0.84.2 event change.
- Electron UtilityProcess API: https://www.electronjs.org/docs/latest/api/utility-process — lifecycle and process creation.
- Electron MessageChannelMain API: https://www.electronjs.org/docs/latest/api/message-channel-main — Main/utility MessagePort transfer.
- Electron MessagePortMain API: https://www.electronjs.org/docs/latest/api/message-port-main — port lifecycle and structured-clone restrictions.

## Related Specs

- `.trellis/workflow.md` — phase and research workflow.
- `.trellis/spec/backend/index.md` — Main-process service, lifecycle, and IPC expectations.
- `.trellis/spec/backend/service-patterns.md` — service ownership and disposal patterns.
- `.trellis/spec/backend/error-handling.md` — error normalization and boundary behavior.
- `.trellis/spec/backend/quality.md` — backend verification expectations.
- `.trellis/spec/frontend/index.md` — renderer boundaries and state conventions.
- `.trellis/spec/frontend/state-management.md` — generation/loading/stale-state requirements.
- `.trellis/spec/frontend/official-pi-renderer.md` — official Pi event projection boundary.
- `.trellis/spec/guides/cross-layer-thinking.md` — end-to-end contract review.
- `.trellis/spec/guides/code-reuse-thinking.md` — preserve stable facade and projection layers.

## Caveats / Not Found

- No production Pi SDK dependency or utility-process host exists in the current worktree; feasibility is based on inspected official 0.84.2 package code and current PiPilot boundaries, not an executed embedded prototype.
- No `src/renderer/adapters/local-pi-adapter.ts` exists. Any plan naming it must be corrected to the actual `PiRpcProvider`/preload/Main facade path.
- The current renderer does not call `localPi.pool`; visible multi-runtime behavior cannot be assumed from the pool implementation alone.
- The task documents simultaneously describe the bundled SDK pin as confirmed and as out of scope. Pinning and packaging the SDK are mandatory for the selected architecture and must be made unambiguous before implementation.
- Exact performance and memory targets are not yet supported by measurements. The current double initialization and per-runtime extension factory behavior make the stated warm-switch claims uncertain.
- One host for all projects is not proven safe for arbitrary plugins. The conservative topology is one host per cwd until a representative compatibility matrix proves otherwise.
- Pi's public SDK covers core runtime creation, but the CLI adds migrations, project trust, built-in extension wiring, proxy/global HTTP setup, model/tool resolution, and diagnostics. Exact CLI parity requires explicit inspection and implementation of whichever of those behaviors PiPilot relies on; importing the SDK alone does not reproduce the CLI bootstrap.
- Packaged behavior of Pi's transitive wasm/optional/native dependencies has not been exercised. Cross-platform packaged testing is a feasibility gate, not a final cleanup step.
- No product code, specs, dependencies, or build configuration were modified by this research.
