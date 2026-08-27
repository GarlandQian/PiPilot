# Research: Embedded Pi SDK Host Feasibility

- Query: Can PiPilot pin the official Pi SDK inside an Electron `utilityProcess`, use `MessagePort`, reproduce the current RPC surface, and reliably host multiple concurrent Pi runtimes with the same global/project extensions as the CLI?
- Scope: mixed (current PiPilot worktree, installed Pi 0.84.2 package/types/source, representative installed extensions, official Electron and Pi upstream material)
- Date: 2026-08-14

## Executive classification

| Capability | Classification | Evidence-based conclusion |
| --- | --- | --- |
| Pin and import Pi SDK in a utility process | **Feasible** | `@earendil-works/pi-coding-agent@0.84.2` publicly exports the SDK/runtime types needed by a custom host. Electron 43 supports utility processes and transferable message ports. |
| Create multiple core runtimes in one Node process | **Feasible for Pi core; experimental for arbitrary extensions** | A local no-extension proof created two concurrent `AgentSessionRuntime` objects with distinct services/model runtimes and replaced one session without changing the other. Pi does not document arbitrary-extension isolation as a guarantee. |
| Load global/project resources with standard discovery | **Feasible with qualifications** | `DefaultResourceLoader` and `SettingsManager` are public and discover merged global/project packages, extensions, skills, prompts, themes, and context. Exact CLI startup parity also includes private orchestration that the SDK does not export. |
| Pay extension load only once per host and make every later runtime ~milliseconds | **Blocked by current public SDK semantics** | Each runtime owns a fresh `DefaultResourceLoader`, `ExtensionRuntime`, extension objects, and factory execution. Only the module factory import is cached, and the cache is process-global but single-cwd. Reusing one `LoadExtensionsResult` across sessions is unsafe because `bindCore()` mutates its shared runtime actions. |
| One host, multiple concurrent workspaces/cwds, exact CLI plugin behavior | **Blocked for arbitrary extensions** | `process.cwd()`, environment, global fetch/Undici dispatcher, module globals, native singletons, timers, and extension dependency caches are process-wide. Installed `pi-pretty` explicitly uses both `process.cwd()` and a `globalThis` singleton finder. |
| Open/switch/new/fork sessions across cwd | **Feasible** | Public `AgentSessionRuntime` methods implement replacement, including `switchSession(path, { cwdOverride })`, `newSession`, `fork`, `importFromJsonl`, and `dispose`. Replacement recreates cwd-bound services and extensions. |
| Preserve commands/models/messages/tree/stats/bash/retry/compaction | **Feasible, but requires a maintained projection** | All command operations are backed by public `AgentSession`, `AgentSessionRuntime`, `SessionManager`, `ModelRuntime`, and `SettingsManager` methods. The reusable RPC command handler/UI bridge/event converter are private closures or non-exported files. |
| Bridge extension dialogs/status/widgets/title | **Feasible** | `AgentSession.bindExtensions()` accepts a public `ExtensionUIContext` and mode `"rpc"`. Pi's own RPC implementation is a direct reference for select/confirm/input/editor, notifications, status, string widgets, title, and editor text. |
| Preserve all extension TUI surfaces | **Blocked by design** | Raw terminal input, component widgets, footer/header factories, custom focused components, editor components, autocomplete providers, themes, and tool expansion require TUI objects/functions and cannot cross structured clone. Official RPC already no-ops or degrades these surfaces. |
| Isolate and dispose every arbitrary extension runtime completely | **Unknown / not guaranteed** | Core session cancellation and `session_shutdown` are public, but there is no public `ResourceLoader.dispose()` or process-global extension teardown contract. Extensions can retain globals, timers, native handles, child processes, event listeners, or servers after a runtime is disposed. |

**Overall:** the requested SDK + `utilityProcess` + `MessagePort` + custom RPC projection architecture is viable. The current PRD's stronger claims—one host safely sharing arbitrary plugins across multiple cwds, a fixed 312 MB total, and extension load being paid exactly once—are not supported by Pi 0.84.2's public contracts. A reliable MVP must either use one utility host per workspace/cwd (with one active `AgentSessionRuntime` switched in-process), or explicitly accept a compatibility tier for process-global plugins and treat multi-runtime-per-host as experimental.

## Version and public API evidence

### Installed and latest checked version

- `pi --version` reports `0.84.2`.
- The selected executable resolves to the fnm installation of `@earendil-works/pi-coding-agent`.
- Its package manifest declares version `0.84.2`, Node `>=22.19.0`, ESM, and only these public subpaths: `.`, `./rpc-entry`, and `./client` (`$PI_PACKAGE_ROOT/package.json:1-51`).
- The official repository's latest Release page reported `v0.84.2` during this research: <https://github.com/earendil-works/pi/releases/latest>.
- PiPilot currently uses Electron `^43.3.0`, electron-vite `^5.0.0`, and electron-builder `26.15.7` (`package.json:37-85`). Electron 43 embeds Node 24.14, which satisfies Pi's Node engine requirement: <https://www.electronjs.org/blog/electron-43-0>.

`$PI_PACKAGE_ROOT` below means the currently selected fnm package root under `~/.local/share/fnm/node-versions/v26.5.0/installation/lib/node_modules/@earendil-works/pi-coding-agent`.

### Public exports that support an embedded host

The root entry publicly exports:

- `AgentSession`, `AgentSessionEvent`, and `SessionStats` (`$PI_PACKAGE_ROOT/dist/index.d.ts:3`).
- extension APIs/types and `ExtensionRunner` (`$PI_PACKAGE_ROOT/dist/index.d.ts:7-8`).
- `DefaultResourceLoader` and `ResourceLoader` (`$PI_PACKAGE_ROOT/dist/index.d.ts:16-17`).
- `createAgentSession`, `createAgentSessionServices`, `createAgentSessionFromServices`, `createAgentSessionRuntime`, `AgentSessionRuntime`, and their option/result types (`$PI_PACKAGE_ROOT/dist/index.d.ts:18`).
- `SessionManager`, session entries, and tree types (`$PI_PACKAGE_ROOT/dist/index.d.ts:19`).
- `SettingsManager` and retry/compaction settings (`$PI_PACKAGE_ROOT/dist/index.d.ts:20`).
- `runRpcMode`, `RpcCommand`, `RpcResponse`, `RpcSessionState`, and extension UI wire types (`$PI_PACKAGE_ROOT/dist/index.d.ts:27`).

The SDK explicitly targets custom web/desktop/mobile interfaces (`$PI_PACKAGE_ROOT/docs/sdk.md:3-14`) and recommends the SDK for same-process type-safe integrations with direct state and extension customization (`$PI_PACKAGE_ROOT/docs/sdk.md:1140-1159`). Pinning should use exact `"0.84.2"`, not `^0.84.2`, if deterministic host behavior is a requirement.

## Multiple runtime feasibility and isolation

### Core runtime proof executed

A read-only, no-session-persistence proof imported the installed public root, disabled resources/tools, created two `AgentSessionRuntime` instances concurrently for different existing cwd values, called `newSession()` on one, and disposed both. Result:

```json
{
  "distinct": true,
  "cwds": ["/private/tmp", "<PiPilot worktree>"],
  "bStable": true,
  "serviceIsolation": true,
  "loaderIsolation": true,
  "modelIsolation": true
}
```

This proves the public core API does not enforce a one-runtime-per-process singleton. It does **not** prove arbitrary plugin compatibility, real provider concurrency, or complete cleanup.

### What is isolated per runtime

- `createAgentSessionServices()` creates a cwd-bound `ModelRuntime`, `SettingsManager`, and `DefaultResourceLoader` unless callers inject them (`$PI_PACKAGE_ROOT/dist/core/agent-session-services.js:53-107`).
- Each loader creates its own event bus (`$PI_PACKAGE_ROOT/dist/core/resource-loader.js:154-183`; `$PI_PACKAGE_ROOT/dist/core/event-bus.js:1-24`).
- Each `AgentSession` constructs its own `ExtensionRunner` from the loader result (`$PI_PACKAGE_ROOT/dist/core/agent-session.js:2017-2050`).
- `AgentSessionRuntime` owns one current session/services pair, while callers may construct multiple runtime objects themselves (`$PI_PACKAGE_ROOT/dist/core/agent-session-runtime.d.ts:38-117`).

### What remains process-global

1. **Extension module cache is one-cwd-at-a-time.** `extensionCacheCwd`, `extensionCacheGeneration`, and `extensionCache` are module globals. Loading a different cwd clears the cache (`$PI_PACKAGE_ROOT/dist/core/extensions/loader.js:113-127`). A loader reload also clears the entire process cache (`$PI_PACKAGE_ROOT/dist/core/resource-loader.js:262-266`). Concurrent different-cwd loads can invalidate each other's cache token; correctness falls back to uncached imports, but the intended amortization disappears.
2. **Extension factories still run per runtime.** Cached entries are factory functions only; every load creates a fresh extension/API and awaits the factory (`$PI_PACKAGE_ROOT/dist/core/extensions/loader.js:351-410,432-459`). A small proof with installed `@narumitw/pi-retry` measured 13.4 ms first load, 2.3 ms same-cwd cached load, 3.9 ms after switching cwd, and 5.2 ms returning to the first cwd. This confirms caching can reduce module import cost but does not make runtime construction free.
3. **The cached factory can share module-scope state.** Jiti uses `moduleCache: false`, but Pi's own factory cache returns the same closure for repeated same-cwd loads (`$PI_PACKAGE_ROOT/dist/core/extensions/loader.js:351-375`). Any variables captured by the module/factory, plus normally imported dependency modules, can be shared across runtime instances.
4. **Working directory and environment are global.** Extensions receive `ctx.cwd` after binding, but factory code and arbitrary library code can call `process.cwd()`/`process.env`. A process cannot present different cwd values simultaneously to multiple runtimes.
5. **Network dispatcher is global.** CLI startup mutates `HTTP_PROXY`/`HTTPS_PROXY`, Undici's global dispatcher, and sometimes `globalThis.fetch` (`$PI_PACKAGE_ROOT/dist/core/http-dispatcher.js:13-94`; `$PI_PACKAGE_ROOT/dist/main.js:454-458,684-687`). Those helpers are not exported from the package root, and one host cannot honor conflicting per-project proxy/idle-timeout settings independently.
6. **Provider compatibility state has globals.** `AgentSession.reload()` calls `resetApiProviders()` from `pi-ai/compat` before rebuilding one session (`$PI_PACKAGE_ROOT/dist/core/agent-session.js:2052-2065`), so a reload has a process-wide side effect even when model runtimes are per session.

### Representative installed-plugin evidence

The current global package list includes `pi-mcp-adapter@2.25.0`, `pi-subagents@0.49.0`, `pi-hermes-memory@0.9.4`, `pi-observational-memory@3.0.4`, `@narumitw/pi-starship@0.50.3`, `@narumitw/pi-retry@0.31.0`, `@heyhuynhgiabuu/pi-pretty@0.6.21`, and a theme-only bundle.

- `pi-mcp-adapter` creates substantial factory-local runtime state and implements `session_shutdown` cleanup, which is compatible with one extension instance per runtime (`~/.pi/agent/npm/node_modules/pi-mcp-adapter/index.ts:68-132,420-440`). However, supporting modules also contain process-level OAuth/auth caches and active-runtime sets, so complete multi-runtime isolation must be tested rather than assumed.
- `pi-retry` keeps timers and retry state inside its factory and clears them on `session_shutdown`, a good per-runtime pattern (`~/.pi/agent/npm/node_modules/@narumitw/pi-retry/src/retry.ts:75-118,206-219`).
- `pi-pretty` reads `process.cwd()` during factory activation (`~/.pi/agent/npm/node_modules/@heyhuynhgiabuu/pi-pretty/dist/index.js:66-84`) and stores one `FffService` under `globalThis[Symbol.for("pi-pretty.fff-service")]` (`.../dist/fff.js:44-69`). Its `ensureFinder(cwd)` returns immediately while an existing finder is alive, and `session_shutdown` intentionally does not destroy it (`.../dist/fff.js:115-144`; `.../dist/index.js:179-185`). Therefore two live workspaces in one host can observe the wrong file index. This is a concrete current-package incompatibility, not a theoretical concern.
- `pi-subagents` contains process-global event/control maps, background timers, and global stores in addition to per-extension state. It needs a dedicated concurrency/cleanup proof before being classified safe for two parent runtimes in one host.

### Consequence for the planned performance claim

The public runtime replacement path aborts the current session, emits `session_shutdown`, disposes it, constructs a new `SessionManager`, and invokes the stored runtime factory again (`$PI_PACKAGE_ROOT/dist/core/agent-session-runtime.js:102-145,147-172,174-249`). The factory recreates services and reloads resources. Therefore:

- in-process session switching removes OS process spawn and initial SDK module loading;
- same-cwd extension module imports may be cached;
- extension factories, extension state, model/settings/resource services, and session binding still run;
- cross-cwd switches invalidate the extension factory cache;
- keeping one prewarmed runtime per session can make UI selection fast only after each runtime has paid its own initialization and at the cost of duplicated session/plugin state.

The acceptance statements "2.3s paid once per host", "subsequent runtimes ~ms", and "one 312MB host for N runtimes" must be treated as benchmark hypotheses. They are not SDK guarantees and should not be acceptance criteria until measured with the user's real extension set.

## Session lifecycle and cwd switching

Public runtime operations are sufficient:

- `switchSession(path, { cwdOverride, withSession, projectTrustContextFactory })` opens the target, tears down the old session, rebuilds services for the session cwd, and rebinds (`$PI_PACKAGE_ROOT/dist/core/agent-session-runtime.js:128-145`).
- `newSession()` and `fork()` use the current session directory and construct replacement sessions (`.../agent-session-runtime.js:147-249`).
- `dispose()` emits `session_shutdown` and disposes the session (`.../agent-session-runtime.js:288-295`).
- SDK documentation warns that subscriptions and extension bindings are session-specific and must be reapplied after replacement (`$PI_PACKAGE_ROOT/docs/sdk.md:153-178`).

The host must serialize replacement per runtime, detach the old session subscription before publishing the new generation, reject late command/UI responses, and bind extension UI/command actions before emitting readiness. PiPilot already has generation and lifecycle invariants in `src/main/local-pi/local-pi-runtime-host.ts:166-291,305-441,444-532`; those semantics should survive the transport rewrite.

## RPC projection feasibility

### Why projection must be maintained by PiPilot

`runRpcMode(runtime)` is public, but it takes over process stdout, attaches stdin, installs process signal handlers, kills tracked children, calls `process.exit`, and returns a never-resolving promise (`$PI_PACKAGE_ROOT/dist/modes/rpc/rpc-mode.js:23-29,275-290,577-653`). It cannot be redirected to a `MessagePort` or instantiated N times.

The reusable pieces are not public package exports:

- `handleCommand` is a closure inside `runRpcMode` (`.../rpc-mode.js:291-572`).
- the RPC `ExtensionUIContext` is a closure (`.../rpc-mode.js:40-224`).
- `toJsonEvent()` is only in `dist/modes/json-event.js`, and that subpath is not listed in package `exports` (`$PI_PACKAGE_ROOT/package.json:12-25`).

PiPilot therefore needs a version-pinned projection copied semantically from 0.84.2 and regression-tested against public `RpcCommand`/`RpcResponse` types. Importing undocumented `dist/...` files would be package-export-unsafe and should not be the design.

### Requested command surfaces

The public API covers the current RPC commands:

- prompt/steer/follow-up/abort: `AgentSession.prompt`, `steer`, `followUp`, `abort` (`$PI_PACKAGE_ROOT/dist/core/agent-session.d.ts:347-433`).
- models/thinking/queue modes: `modelRuntime.getAvailableSnapshot`, `setModel`, cycling and setter methods (`.../agent-session.d.ts:437-483`).
- compaction/retry: `compact`, `setAutoCompactionEnabled`, `abortRetry`, `setAutoRetryEnabled` (`.../agent-session.d.ts:485-542`).
- bash: extension `user_bash` interception plus `executeBash`, `recordBashResult`, and `abortBash` (`.../agent-session.d.ts:544-569`; RPC reference `$PI_PACKAGE_ROOT/dist/modes/rpc/rpc-mode.js:436-461`).
- stats/export/messages/commands: public session/runtime/loader methods (`.../agent-session.d.ts:603-647`; RPC reference `.../rpc-mode.js:463-565`).
- entries/tree: public `SessionManager.getEntries/getTree/getLeafId` (`$PI_PACKAGE_ROOT/dist/core/session-manager.d.ts:261-287`).
- switch/new/fork/clone: public `AgentSessionRuntime` replacement methods (`$PI_PACKAGE_ROOT/dist/core/agent-session-runtime.d.ts:73-104`).

The authoritative RPC command/response/UI types are public (`$PI_PACKAGE_ROOT/dist/modes/rpc/rpc-types.d.ts:14-455`). PiPilot's current Zod surface already validates these DTOs and forwards generation-tagged events (`src/shared/local-pi.ts:935-980`; `src/main/ipc/register-local-pi-ipc.ts:136-224`). The host protocol should add `runtimeId` and request correlation outside the Pi payload rather than weaken those schemas.

## Extension UI bridge

`AgentSession.bindExtensions()` publicly accepts a caller-supplied `ExtensionUIContext`, mode, command actions, shutdown handler, and error listener (`$PI_PACKAGE_ROOT/dist/core/agent-session.d.ts:145-152,506-517`). `ExtensionUIContext` includes both portable and TUI-only methods (`$PI_PACKAGE_ROOT/dist/core/extensions/types.d.ts:35-192`).

The official RPC behavior is a suitable compatibility target:

- portable dialogs: `select`, `confirm`, `input`, `editor`;
- one-way surfaces: `notify`, `setStatus`, string-array `setWidget`, `setTitle`, `setEditorText`;
- degraded/no-op: terminal input, working indicator customization, component widgets, footer/header, custom components, autocomplete providers, custom editor, theme switching, and tool expansion (`$PI_PACKAGE_ROOT/dist/modes/rpc/rpc-mode.js:83-224`).

Important timeout facts:

- Pi's public dialog options support `AbortSignal` and `timeout` (`$PI_PACKAGE_ROOT/dist/core/extensions/types.d.ts:35-41`).
- Official RPC applies timeout/abort cleanup to select/confirm/input (`.../rpc-mode.js:46-78`), but its editor implementation has neither timeout nor abort cleanup (`.../rpc-mode.js:174-192`).
- PiPilot's dialog close path already sends `{ cancelled: true }` (`src/components/chat/ExtensionUiDialog.tsx:48-65`) and Main validates generation/id/method (`src/main/local-pi/local-pi-runtime-host.ts:397-435`).

The embedded bridge can improve liveness by giving **every** request, including editor, a host-owned deadline; cancelling all pending requests on runtime replacement/disposal; and rejecting late responses by `{hostGeneration, runtimeId, runtimeGeneration, requestId}`. This is an intentional PiPilot liveness rule, not exact 0.84.2 RPC behavior.

One unresolved semantic is extension `ctx.shutdown()`: CLI RPC treats it as whole-process shutdown. In a shared host, the safe default is runtime-only disposal, but that differs from CLI behavior and should be an explicit product decision.

## Disposal and failure boundaries

Core cleanup is bounded but not comprehensive for arbitrary extensions:

- `AgentSession.dispose()` aborts retry, compaction, branch summary, bash, and agent execution; invalidates extension contexts; unsubscribes; and runs registered Pi AI session-resource cleanups (`$PI_PACKAGE_ROOT/dist/core/agent-session.js:545-570`).
- `AgentSessionRuntime.dispose()` first awaits extension `session_shutdown` (`$PI_PACKAGE_ROOT/dist/core/agent-session-runtime.js:288-295`).
- There is no `ResourceLoader.dispose()` contract (`$PI_PACKAGE_ROOT/dist/core/resource-loader.d.ts:29-59`).
- CLI RPC separately kills tracked detached children on process signal and finally exits the entire process (`$PI_PACKAGE_ROOT/dist/modes/rpc/rpc-mode.js:275-288,577-595`), which is the ultimate cleanup boundary the embedded shared host loses.

Required host policy:

1. serialize lifecycle operations per runtime;
2. abort and await session idle with a deadline;
3. emit/await `session_shutdown` with a deadline;
4. cancel pending MessagePort commands and extension UI requests;
5. dispose the runtime and remove all host subscriptions;
6. if cleanup exceeds the deadline or the plugin leaves the host unhealthy, terminate and recreate the **whole utility process**;
7. treat utility-process crash/exit as failure of every runtime in that host and publish typed diagnostics.

Because arbitrary plugin cleanup cannot be proven, process restart remains the only dependable reclamation boundary.

## Electron transport and packaging

- Electron `utilityProcess.fork(modulePath, args?, options?)` runs a Node-capable child under Chromium's Services API, supports ESM, can be sandboxed, and exposes `postMessage`/`message`, `spawn`, and `exit`: <https://www.electronjs.org/docs/latest/api/utility-process>.
- `UtilityProcess.postMessage(message, transfer?)` can transfer `MessagePortMain`; the child receives it through `process.parentPort`: <https://www.electronjs.org/docs/latest/api/utility-process> and <https://www.electronjs.org/docs/latest/api/process>.
- `MessagePortMain` is event-driven and must be `start()`ed when using `on('message')`; it supports `close`, `pause/start`, `ref/unref`, and structured-clone messages: <https://www.electronjs.org/docs/latest/api/message-port-main>.
- The current electron-vite main build has only `index` and `pi-management-helper` entries (`electron.vite.config.ts:8-19`). A host entry must be added and verified in both dev and packaged output.
- The pinned SDK must be a production dependency so electron-builder includes it. Its transitive tree includes WASM and optional/native packages, while user extensions can load native modules from `~/.pi/agent/npm`; macOS, Windows, and Linux packaged smoke tests are mandatory.

Structured clone cannot carry extension functions, TUI components, `Error` prototypes with custom fields, streams, or circular class graphs. Only explicitly projected plain DTOs should cross the port. Large messages/tree payloads still need size/node/depth limits even though JSONL framing disappears.

## Current PiPilot impact

PiPilot's existing host is not a thin spawn wrapper: it owns target normalization, lifecycle serialization, generation replacement, deadlines, response correlation, typed diagnostics, UI request correlation, graceful/forced shutdown, stderr bounds, and snapshot publication (`src/main/local-pi/local-pi-runtime-host.ts:102-164,166-291,293-441,444-532`). The pool adds runtime identity, leases, capacity, selection, and independent event/UI routing (`src/main/local-pi/local-pi-runtime-pool.ts:293-395`). IPC preserves event order around catalog observation (`src/main/ipc/register-local-pi-ipc.ts:148-172`).

The refactor should preserve these contracts and replace only the owned transport/runtime implementation. It should not move MessagePorts into the renderer; Renderer ↔ Main remains the validated IPC boundary.

The current spec explicitly says PiPilot does not embed an SDK and has no bundled fallback (`.trellis/spec/backend/index.md:1-16`; `.trellis/spec/backend/local-pi-rpc.md:1-31`). Implementation will require a deliberate spec replacement after the design is approved, not an additive exception.

## Minimal proof experiment before full implementation

Create a disposable, feature-gated host slice and require all gates below before replacing the CLI path:

1. **Build/package gate**
   - Add an electron-vite utility entry that imports exact `@earendil-works/pi-coding-agent@0.84.2`.
   - Establish Main ↔ utility `MessageChannelMain`, ping/pong, crash/exit handling, port close, and restart.
   - Run unpacked and packaged smoke tests on macOS, `windows-2025`, and Linux.
2. **Public-SDK runtime gate**
   - Create one persisted runtime and one no-session runtime from public exports only.
   - Open, new, switch across cwd, fork, clone, dispose, and recreate.
   - Assert old events/UI responses cannot cross generations.
3. **Projection parity gate**
   - Table-drive every public 0.84.2 `RpcCommand` against the old CLI RPC fixture and the new host.
   - Compare response/event DTOs after removing only transport metadata.
   - Include deep trees, large messages, bash streaming/abort, retry, compaction, model changes, queueing, and extension errors.
4. **Extension UI gate**
   - Test all portable methods and every TUI degradation.
   - Close/dismiss/timeout every dialog, especially editor; replace/dispose during a pending dialog.
5. **Real extension compatibility gate**
   - Run at least `pi-mcp-adapter`, `pi-subagents`, `pi-retry`, and `pi-pretty` in isolated fixtures.
   - Test two sessions in one cwd, then two concurrent cwd values.
   - Prove MCP/subagent child cleanup and demonstrate whether `pi-pretty` indexes the correct cwd. The expected current result for two cwds in one host is failure, which should decide the host-per-workspace boundary.
6. **Performance/memory gate**
   - Record cold host start, first runtime, cached same-cwd runtime, cross-cwd runtime, session switch, and disposal RSS/heap/external memory.
   - Compare against the same real extension set under CLI RPC. Do not encode `~ms` or `312MB` thresholds until these measurements exist.
7. **Migration gate**
   - Retain the existing CLI implementation only as a test oracle and temporary migration branch until packaged parity passes. The production architecture remains bundled-SDK-only; a host startup failure must be typed and visible rather than silently selecting another runtime path.

## Planning changes required by the evidence

1. Correct the PRD contradiction: "Bundled SDK pin" is both a confirmed requirement and listed Out of Scope. It must be in scope and pinned exactly.
2. Replace the unverified performance/memory numbers with benchmark targets determined by the proof experiment.
3. Decide the supported host topology:
   - **recommended reliability boundary:** one long-lived utility host per workspace/cwd, one active `AgentSessionRuntime` per host, in-process session replacement, bounded host count;
   - **higher-risk alternative:** one shared host with multiple concurrent runtimes, documented plugin compatibility tier, and forced host restart on global-state conflicts.
4. Define `ctx.shutdown()` semantics in a shared host.
5. Define whether exact CLI startup parity includes built-in hidden extensions, migrations, project-trust extension hooks, proxy/dispatcher mutation, and first-run behavior. The SDK exports resource/session primitives but not the full CLI orchestration (`$PI_PACKAGE_ROOT/dist/main.js:440-687`).

## Files found

- `package.json` — PiPilot Electron/build dependency versions and current absence of the Pi SDK.
- `electron.vite.config.ts` — current Main helper entry pattern; no utility host entry.
- `src/main/local-pi/local-pi-runtime-host.ts` — current process lifecycle, generation, correlation, validation, and UI response owner.
- `src/main/local-pi/local-pi-runtime-pool.ts` — current multi-runtime identity/lease/capacity model.
- `src/main/ipc/register-local-pi-ipc.ts` — validated Main/Renderer boundary and event ordering.
- `src/shared/local-pi.ts` — current exact RPC/event/UI/snapshot Zod contracts.
- `src/components/chat/ExtensionUiDialog.tsx` — renderer cancellation behavior.
- `.trellis/spec/backend/index.md` and `.trellis/spec/backend/local-pi-rpc.md` — current official-executable architecture that this task intentionally replaces.
- `$PI_PACKAGE_ROOT/package.json` — Pi 0.84.2 package exports and Node engine.
- `$PI_PACKAGE_ROOT/dist/index.d.ts` — public SDK/runtime/RPC exports.
- `$PI_PACKAGE_ROOT/dist/core/agent-session-runtime.*` — replacement lifecycle.
- `$PI_PACKAGE_ROOT/dist/core/agent-session.*` — commands, events, extension binding, disposal.
- `$PI_PACKAGE_ROOT/dist/core/agent-session-services.*` — cwd-bound service creation.
- `$PI_PACKAGE_ROOT/dist/core/resource-loader.*` and `dist/core/extensions/loader.*` — resource discovery and process-global extension factory cache.
- `$PI_PACKAGE_ROOT/dist/modes/rpc/rpc-mode.js` — authoritative 0.84.2 RPC projection/UI semantics, but not reusable as a MessagePort host.
- `$PI_PACKAGE_ROOT/docs/sdk.md` and `docs/rpc.md` — official SDK/RPC documentation.
- representative installed extension sources under `~/.pi/agent/npm/node_modules/` — current real plugin lifecycle/global-state evidence.

## External references

- Pi repository and latest release: <https://github.com/earendil-works/pi>, <https://github.com/earendil-works/pi/releases/latest>
- Electron utility process: <https://www.electronjs.org/docs/latest/api/utility-process>
- Electron process `parentPort`: <https://www.electronjs.org/docs/latest/api/process>
- Electron `MessagePortMain`: <https://www.electronjs.org/docs/latest/api/message-port-main>
- Electron 43 release/Node version: <https://www.electronjs.org/blog/electron-43-0>

## Related specs

- `.trellis/spec/backend/index.md`
- `.trellis/spec/backend/local-pi-rpc.md`
- `.trellis/spec/backend/type-and-validation-patterns.md`
- `.trellis/spec/backend/directory-structure.md`
- `.trellis/spec/frontend/official-pi-renderer.md`
- `.trellis/spec/frontend/type-safety.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`

## Caveats / Not Found

- Pi's public docs do not promise arbitrary extension isolation across multiple simultaneous runtimes in one process.
- No public API was found for reusing a loaded extension set safely across sessions, disposing a `DefaultResourceLoader`, redirecting `runRpcMode` to a custom transport, or importing its command/UI implementation without undocumented `dist` subpaths.
- The no-extension concurrency proof and one-extension cache timing proof are not substitutes for a packaged real-plugin benchmark.
- Memory and latency claims in the current PRD were not reproduced during this research and should remain hypotheses.
