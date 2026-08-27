# Research: Electron Utility Host Feasibility

- Query: Can PiPilot use Electron 43 `utilityProcess` plus MessagePort to host a bundled Pi SDK, multiple in-process runtimes, and a MessagePort-native RPC projection reliably in development and packaged applications?
- Scope: mixed (current PiPilot worktree, installed Electron/Pi artifacts, and official Electron/Node/electron-vite/electron-builder documentation)
- Date: 2026-08-14

## Findings First

1. **Electron 43 is capable of this topology.** PiPilot resolves Electron 43.3.0, and its bundled runtime reports Node 24.18.1 / module ABI 148 / N-API 10. `utilityProcess.fork()` is available after `app.ready`, provides a full Node process, supports structured-clone messaging and transferable `MessagePortMain` ports, and exposes lifecycle events plus stdout/stderr. The bundled Pi SDK 0.84.2 declares Node `>=22.19.0`, so the declared Node floor is satisfied.
2. **`utilityProcess` is the best of the three process choices for the user-selected architecture.** It provides a separate crash/event-loop boundary like `child_process`, but is integrated with Electron process lifecycle, metrics, and MessagePort transfer. `worker_threads` does not provide the desired process fault boundary and has Node API differences such as no `process.chdir()`.
3. **ESM entry generation is feasible.** The application is already ESM (`package.json` has `"type": "module"`) and already builds multiple Electron Main entries. Either a named Main Rollup input or electron-vite's documented `?modulePath` worker-entry mechanism can emit a Utility Process entry. The host entry must stay inside `app.asar` because the packaged binary enables `OnlyLoadAppFromAsar`.
4. **The MessagePort boundary must carry only validated DTOs.** `postMessage()` uses structured clone and returns `void`; functions, live SDK classes, callbacks, and other uncloneable state cannot cross. PiPilot has already observed Electron's `An object could not be cloned` failure class. Raw `AgentSession`, extension, tool, or model objects must never be posted. Host-side projection and schema validation are mandatory, not optional polish.
5. **MessagePort has no documented drain/backpressure API.** `MessagePortMain.postMessage()` and `UtilityProcess.postMessage()` return `void`. A long streaming turn or a large history/tree response can therefore grow an unbounded queue unless PiPilot adds its own flow control, bounded outbound queues, generation/sequence numbers, and large-response chunking or request/ack windows.
6. **Packaging is the first hard gate.** The installed Pi 0.84.2 closure is about 139 MiB / 13,181 files and contains 12 native `.node` files plus 2 WASM files. It also starts its own image-resize `worker_threads` worker. electron-builder can automatically unpack native modules, but PiPilot must verify the actual produced ASAR/unpacked tree and execute the native/WASM/worker paths on every release platform.
7. **A Utility Process alone does not prove the claimed 2.3 s amortization.** Pi's public `AgentSessionRuntime` tears down and recreates cwd-bound services during `switchSession()`/`newSession()`. `createAgentSessionServices()` creates a new `DefaultResourceLoader` and calls `reload()`. The extension module cache is process-global but clears when cwd changes, and extension factories/runtime binding still occur per recreated session. A real-plugin benchmark must prove same-cwd and cross-cwd second-runtime behavior before the PRD may promise “paid once per host start” or “switches in milliseconds.”
8. **One host creates a larger failure domain.** A crash, infinite loop, `process.exit()`, native addon fault, or process-global mutation from one extension can affect every runtime in the host. The Main/Renderer survive, but all hosted runtimes are lost together. Restart can reopen persisted sessions; it cannot safely replay an in-flight prompt or tool call.
9. **The MessagePort-native RPC rewrite is feasible but has high upstream-drift cost.** Pi 0.84.2 publicly exports `runRpcMode()`, RPC types, and SDK runtime factories, but `runRpcMode()` is a forever-running stdin/stdout JSONL owner. Its internal command dispatcher, `toJsonEvent`, extension UI context, and stdout backpressure hooks are not exported as structured-object adapters. A native projection must reproduce this behavior or retain JSONL internally. Because the user selected a native MessagePort projection, parity tests against the pinned official RPC mode are required.
10. **Recommendation: approve a bounded feasibility spike, not the full rewrite yet.** Use `utilityProcess` and MessagePort as selected, but make the first implementation gate a packaged, cross-platform prototype. Continue to the full pool/projection rewrite only if the spike proves packaging, clone safety, bounded transport, extension compatibility, and measured load/RSS improvements.

## Current PiPilot Evidence

### Files Found

| File | Relevant evidence |
| --- | --- |
| `package.json` | ESM application; Electron `^43.3.0`, electron-vite `^5.0.0`, electron-builder 26.15.7; currently no Pi SDK production dependency. |
| `electron.vite.config.ts` | Main build already uses named Rollup inputs for `index` and `pi-management-helper` (`:8-20`). |
| `electron-builder.yml` | Packages `out/**/*` and production dependencies into ASAR; explicitly unpacks node-pty native files (`:9-23`). |
| `build/apply-electron-fuses.cjs` | Packaged app enables `RunAsNode` and `OnlyLoadAppFromAsar`, while disabling `NODE_OPTIONS` and CLI inspect args (`:25-44`). |
| `src/main/index.ts` | Long-lived services are composed after initialization; shutdown is centralized and already awaits runtime/pool disposal (`:189-260`, `:305-360`). |
| `src/main/local-pi/local-pi-runtime-host.ts` | Current child-process owner has generation tracking, validated JSONL, request timeouts, extension UI correlation, and bounded shutdown; these semantics must survive transport replacement (`:30-100`, `:166-233`, `:293-435`). |
| `src/main/local-pi/local-pi-runtime-pool.ts` | Current pool constructs one `LocalPiRuntimeHost` per runtime and leases persisted Session paths (`:42-64`, `:92-188`, `:237-317`). |
| `src/shared/local-pi.ts` | Existing Zod schemas and renderer-facing DTOs are reusable as the boundary contract; the current supported executable protocol version is 0.84.1 (`:1-31`). |
| `tests/packaged/pipilot.packaged.spec.ts` | Existing packaged smoke inspects ASAR, currently requires `hasEmbeddedPiSdk: false`, checks fuses, and exercises packaged startup (`:162-224`, `:312-330`). This is the natural host packaging gate. |
| `.trellis/spec/backend/local-pi-rpc.md` | Current official boundary is executable + JSONL and explicitly says there is no bundled fallback. This task intentionally replaces that contract and will require a later spec update. |
| `.trellis/spec/backend/service-patterns.md` | Long-lived process/port owners need explicit construction, subscription cleanup, bounded errors, and application shutdown disposal. |

### Installed Runtime Evidence

- Resolved Electron is **43.3.0**. Running its development binary with `ELECTRON_RUN_AS_NODE=1` reported:
  - Node 24.18.1
  - V8 15.0.245.23-electron.0
  - Node module ABI 148
  - N-API 10
- Electron's installed type declarations establish:
  - `utilityProcess.fork()` is callable only after `app.ready` (`node_modules/electron/electron.d.ts:15582-15590`).
  - Lifecycle/events: `spawn`, `message`, `exit`, experimental fatal `error` (`:15592-15751`).
  - `kill()` is graceful; POSIX uses SIGTERM (`:15752-15757`).
  - `postMessage(message, transfer?)` can transfer `MessagePortMain` objects (`:15759-15764`).
  - `MessagePortMain.postMessage()` returns `void`, has `message`/`close`, and requires `start()` for queued delivery (`:9719-9752`).
  - The child receives messages through `process.parentPort`, whose messages queue until a handler is registered (`:10738-10755`, `:27065-27068`).
  - `ForkOptions` supports `env`, `execArgv`, `cwd`, Electron `session`/`partition`, stdout/stderr modes, `serviceName`, and macOS-only unsigned-library/disclaim switches (`:21633-21709`). stdin cannot be piped through this API.
- The resolved local `@earendil-works/pi-coding-agent` artifact is **0.84.2**, is ESM, exports SDK and RPC APIs from its package root, and declares Node `>=22.19.0` (`package.json:2-25`, `:45-77`, `:105-107`).
- Its installed closure is approximately **139 MiB**, **13,181 files**, **12 native `.node` files**, and **2 WASM files**. Important examples:
  - `@earendil-works/pi-tui` ships darwin x64/arm64 and Windows x64/arm64 N-API helpers.
  - optional `@mariozechner/clipboard-*` packages ship platform native libraries.
  - `@silvia-odwyer/photon-node` ships a WASM image processor.
  - Pi image resizing creates a nested Node Worker from a URL relative to the installed package and falls back to in-process work on worker failure (`dist/utils/image-resize.js:1-84`).

## ESM and Entry-Point Feasibility

### Feasible shape

```ts
// Main, after app.whenReady()
const child = utilityProcess.fork(hostModulePath, [], {
  cwd: applicationCwd,
  env: process.env,
  serviceName: 'Pi SDK Host',
  stdio: ['ignore', 'pipe', 'pipe'],
})
```

The host can be emitted in either of two supported ways:

1. **Existing PiPilot pattern:** add a named entry to `main.build.rollupOptions.input`, then resolve it relative to `import.meta.dirname`. This matches the existing management helper.
2. **electron-vite worker pattern:** `import hostModulePath from './host/index?modulePath'`, then pass the returned generated path to `utilityProcess.fork()`. electron-vite documents this exact Utility Process pattern and supports it from the Main process.

Recommendation: prefer `?modulePath` for the spike because it makes the child-entry relationship explicit and lets electron-vite own dev/build path rewriting. Use a named Rollup input instead if the project requires a stable artifact name for ASAR inspection. Do not put executable host JS in `extraResources`: `OnlyLoadAppFromAsar` is enabled and the current package policy keeps executable application code in `out/` inside the archive.

### Dependency externalization

- electron-vite externalizes Node dependencies by default; the Pi package should therefore be a pinned **production dependency**, not a devDependency.
- electron-builder's installed configuration contract states that production `node_modules` are copied even with custom `files` patterns, and that native modules needing unpack are auto-detected (`app-builder-lib .../PlatformSpecificBuildOptions.d.ts:61-64`, `:122-131`).
- Automatic detection must not be trusted without artifact inspection. Add explicit `asarUnpack` patterns if any Pi native/WASM/worker path fails in the built app.

### Packaging blockers to prove

1. Root ESM import of the pinned Pi package from inside `app.asar`.
2. Correct platform/architecture native prebuild inclusion and loading.
3. Photon WASM availability from an archived dependency.
4. Pi's nested image-resize Worker resolving from `app.asar` or an intentional unpacked path.
5. User-installed extension resolution from outside the ASAR, including TS/Jiti extensions and nested dependencies.
6. Any native dependency owned by a user extension. A native extension compiled for the user's separate Node/Pi installation may not match Electron's module ABI 148 unless it uses a compatible N-API ABI.
7. Release size increase and install/update time after adding the roughly 139 MiB unpruned local closure.

## MessagePort Transport Design

### Bootstrap choices

- The minimum path uses `UtilityProcess.postMessage()` on Main and `process.parentPort` in the host. This is already the Utility Process MessagePort channel.
- If the design requires a literal `MessagePortMain`, Main may create a `MessageChannelMain`, retain `port1`, and transfer `port2` in a bootstrap message. Main must call `port1.start()`.
- A single multiplexed host port with `{ runtimeId, generation, requestId, type, payload }` envelopes is sufficient for the first version. Per-runtime ports add isolation but also lifecycle and leak risk; add them only if measurement shows value.

### Required envelope properties

```ts
type HostEnvelope =
  | { kind: 'request'; requestId: string; runtimeId?: string; generation: number; command: HostCommand }
  | { kind: 'response'; requestId: string; runtimeId?: string; generation: number; result: HostResult }
  | { kind: 'event'; runtimeId: string; generation: number; seq: number; event: LocalPiRpcEvent }
  | { kind: 'credit'; runtimeId?: string; throughSeq: number }
```

Rules:

- Validate every inbound envelope on both sides with shared Zod schemas.
- Project SDK values to clone-safe plain data before calling `postMessage()`.
- Normalize `Error` to bounded `{ name, message, stack?, code? }`; never post arbitrary thrown objects.
- Retain `runtimeId`, process `generation`, and monotonic event `seq` so late events from a crashed/restarted host cannot mutate current Renderer state.
- Set request deadlines and delete settled/expired correlation entries.
- Preserve the existing 16 MiB upper-bound policy as a starting safety ceiling, but chunk large histories/trees instead of posting a single near-limit object.

### Structured clone limits

Electron's MessagePort documentation defines messages as serializable objects and Node documents its MessagePort serialization as the HTML structured clone algorithm with Node-specific differences. Safe DTOs include plain records/arrays, strings, numbers, booleans, null, ArrayBuffers/typed arrays, Maps/Sets, Dates, and other documented cloneable values. Unsafe boundary values include functions/callbacks, weak collections, Symbols, many native-backed objects, and class behavior/prototypes.

For PiPilot this means:

- Never post an `AgentSession`, `AgentSessionRuntime`, `ExtensionRunner`, extension API, model runtime, tool implementation, AbortSignal/controller, stream, or Electron object.
- Do not assume a Pi SDK event is clone-safe merely because its TypeScript type looks serializable; run it through the projection/schema owner first.
- Test clone rejection deliberately and ensure it becomes a bounded host diagnostic rather than an Electron IPC handler failure.

### Backpressure

Unlike Node child-process IPC (`subprocess.send()` returns a boolean when the channel backlog is high), Electron MessagePort `postMessage()` returns no pressure signal. The host must implement one of:

- bounded per-runtime queues plus credit/ack messages;
- a global byte/record window with priority lanes for lifecycle/response messages;
- chunked streaming for history/tree payloads and coalescing for replaceable status/token-delta events.

Recommended first version:

- responses and lifecycle messages are never dropped;
- token/status events may coalesce only when the Renderer contract permits it;
- queue limits are measured in both count and estimated bytes;
- overflow fails the affected runtime with a typed protocol error rather than exhausting the host;
- pending extension UI requests are a separate bounded map with timeouts.

## Lifecycle, Crash Recovery, and Shutdown

### Startup

1. Wait for `app.whenReady()`.
2. Fork one host and attach `spawn`, `message`, `exit`, `error`, stdout, and stderr listeners before sending bootstrap.
3. Complete a versioned handshake: protocol version, Pi SDK version, Electron/Node versions, host generation, supported capabilities.
4. Only then allow runtime creation.

### Crash behavior

On `exit`, `close` of the port, invalid protocol, or fatal error:

- increment host generation;
- reject every pending request with a typed `HOST_EXITED`/`HOST_PROTOCOL_ERROR`;
- clear pending extension UI requests and dismiss their Renderer dialogs;
- mark all hosted runtimes interrupted/crashed;
- release or re-establish Session leases deliberately;
- do not replay prompts, tool calls, mutations, or extension UI responses;
- optionally restart with bounded exponential backoff and a circuit breaker;
- lazily reopen only persisted idle sessions after a fresh handshake.

One host means one blast radius. A future sharded pool can reduce it, but a single-host MVP must make this visible in runtime state rather than silently recreating all work.

### Shutdown

Main already has a centralized `disposeApplicationResources()` path. The new controller should join it:

1. stop accepting public commands;
2. send a correlated `shutdown` command;
3. host aborts active turns, emits `session_shutdown`, disposes every runtime, closes nested workers/children, and acknowledges;
4. Main closes the port and waits a bounded interval for `exit`;
5. call `UtilityProcess.kill()` on timeout;
6. record a bounded diagnostic if the process still fails to exit.

Because `UtilityProcess.kill()` has no signal argument in Electron 43, the design should not claim the same TERM/SIGKILL escalation API as `ChildProcess`. If a hard-kill fallback is required, validate an explicit `process.kill(pid, signal)` strategy on macOS, Windows, and Linux before relying on it.

## Process Choice Comparison

| Criterion | `utilityProcess` | `child_process` | `worker_threads` |
| --- | --- | --- | --- |
| Separate OS process / Main fault isolation | Yes | Yes | No |
| Electron-supported MessagePort transfer | Yes | Not via the Electron `MessagePortMain` API; Node IPC has its own serialization/handle model | Uses Node `MessagePort`, not Electron `MessagePortMain` |
| Electron lifecycle/metrics integration | Yes (`serviceName`, app metrics, process events) | Generic OS child | Worker lifecycle only |
| Packaged runtime availability | Uses bundled Electron Node | Requires system Node or `process.execPath` + `ELECTRON_RUN_AS_NODE`; PiPilot currently keeps this fuse enabled | Uses bundled Electron Node in same process |
| stdout/stderr and native backpressure | Optional stdout/stderr; MessagePort has no drain | Strong stdio and `send()` pressure signal | Node port semantics; same-process memory |
| Standard Node process semantics for extensions | Closest fit | Closest fit | Differences: no `process.chdir()`, separate worker restrictions |
| Native addon/plugin crash blast radius | Host process | Child process | Entire Electron process may be lost on native fault |
| Shared module graph across N runtimes | Yes, inside one host | Only if one child hosts N runtimes | Yes, inside one worker isolate; not shared with other workers |
| Best fit for selected architecture | **Yes** | Viable fallback, but not the selected MessagePort/Electron topology | No |

`child_process` remains the best rollback path because PiPilot already has mature generation, timeout, JSONL, and shutdown handling and its packaged fuse enables `ELECTRON_RUN_AS_NODE`. It is not the preferred target because the user explicitly selected Utility Process + MessagePort and because Utility Process integrates better with Electron process ownership.

## Pi SDK and Projection Constraints

### SDK runtime replacement is not free by contract

The installed Pi SDK documentation says `AgentSessionRuntime` replacement recreates cwd-bound services and requires session event subscriptions and extension binding to be re-established. Its implementation confirms:

- `switchSession()` tears down the current session, then calls the stored runtime factory again (`dist/core/agent-session-runtime.js:102-145`).
- `newSession()` does the same (`:147-172`).
- `createAgentSessionServices()` creates a `DefaultResourceLoader` and awaits `resourceLoader.reload()` (`dist/core/agent-session-services.js:53-107`).
- `DefaultResourceLoader.reload()` resolves packages and calls `loadFinalExtensionSet()` (`dist/core/resource-loader.js:262-327`).
- the extension loader has a process-global cache, but it clears that cache when cwd changes (`dist/core/extensions/loader.js:113-127`).

Therefore the host can share imported module code and model/provider packages, but the exact extension discovery/factory/binding cost must be benchmarked. Do not encode a “~ms switch” acceptance threshold until this experiment produces numbers.

### Public RPC reuse boundary

Pi 0.84.2 exposes `runRpcMode(runtimeHost)` as a public API, but it takes over process stdout, listens to stdin JSONL, owns signal/shutdown handling, and never returns. It contains the canonical:

- command dispatcher;
- success/error response shapes;
- session event projection (`toJsonEvent`);
- extension UI context and timeouts;
- session rebinding logic;
- stdout backpressure integration.

Those lower-level projection/dispatcher helpers are not exported from the package root. A MessagePort-native implementation must either:

1. reproduce and parity-test them against the pinned version; or
2. keep `runRpcMode()` behind in-memory streams/JSONL inside the host, then bridge parsed objects to MessagePort.

The user selected option 1. That is technically feasible, but it is a maintained compatibility fork. Pinning the SDK and storing an explicit protocol version is essential. Prefer the SDK's public runtime/session types and existing PiPilot shared DTO schemas; do not deep-import unexported `dist/modes/rpc/*` modules.

### Extension UI

The official RPC implementation already provides timeout/abort handling for select/confirm/input when an extension supplies `opts.timeout`; editor uses a separate promise without such a timeout. PiPilot's host should add an application-level maximum for every blocking dialog, including editor and requests whose extension omitted a timeout. Renderer dismissal must immediately send cancellation; host timeout is the last-resort breaker.

## Security Boundary (Capability Facts, Not a Product Policy)

- Utility Process gives **fault and event-loop isolation**, not a sandbox for Pi extensions. The host has Node filesystem, process, network, and child-process capabilities under the user's account.
- `app.enableSandbox()` protects renderer processes; it does not turn an SDK-hosting Node Utility Process into a restricted plugin sandbox.
- All runtimes in one host share process globals, environment, module caches, native libraries, and CPU/memory budget. A plugin may contaminate another runtime even if DTO routing is correct.
- The MessagePort is still a trust boundary for application correctness: schemas, size limits, request correlation, generation checks, and error normalization prevent accidental object leakage and stale mutation.
- macOS `allowLoadingUnsignedLibraries` should remain false unless a concrete packaged native-plugin test requires it. Electron explicitly recommends leaving it disabled unless needed. The current unsigned/non-hardened build does not justify enabling it preemptively.

## Platform Differences

| Platform | Required proof |
| --- | --- |
| macOS arm64 | Host entry in ASAR; Pi/TUI native arm64 load; Photon/WASM; no unexpected Helper (Plugin) entitlement requirement; clean quit. |
| macOS x64 | Separate x64 artifact, not Rosetta-only inference; x64 native prebuild and nested Worker. |
| Windows x64 | Utility host starts without console/window artifacts; Unicode/space/parenthesis/ampersand cwd; Pi native prebuild; crash/kill/quit; packaged NSIS/unpacked smoke. |
| Linux x64 | AppImage and/or deb host startup; GNU native optional dependencies; nested Worker; process shutdown; no dependence on a system Node binary. |

Cross-compiling and ASAR inspection are not enough. Each target must execute the packaged host and create a real SDK runtime in the target OS CI runner.

## Minimal Prototype Experiment

The spike should be isolated behind a development/test flag and must not replace the current CLI path until all gates pass.

### Step 1: Build/transport skeleton

- Emit one ESM Utility Process entry.
- Fork after `app.whenReady()`.
- Transfer or use the built-in MessagePort channel.
- Complete a versioned ping/handshake.
- Validate request/response correlation, port close, child exit, and graceful shutdown.

### Step 2: Clone and pressure probes

- Round-trip every existing `LocalPiRpcCommand`, response, event, and extension UI DTO fixture.
- Intentionally attempt a function, class instance, circular object, `Error`, typed array, 1 MiB object, and current 16 MiB policy boundary.
- Implement a small credit window and prove bounded memory when the receiver pauses.

### Step 3: SDK import/runtime

- Pin `@earendil-works/pi-coding-agent@0.84.2` as a production dependency for the spike.
- Import only public package exports.
- Create a runtime in a temporary cwd/agentDir fixture without touching the developer's real Pi data.
- Create/switch/dispose two same-cwd sessions and two different-cwd sessions.
- Record cold import, extension discovery, extension factory/bind, switch, and disposal timings separately.

### Step 4: Extension compatibility matrix

- pure JS extension;
- TS/Jiti extension;
- npm package extension with nested dependencies;
- extension importing Pi virtual aliases;
- extension with select/confirm/input/editor and no timeout;
- extension spawning a child process;
- representative native dependency or an explicit documented incompatibility result.

### Step 5: Packaged execution

- Build `package:dir` on macOS arm64/x64, Windows x64, and Linux x64.
- Inspect ASAR and `app.asar.unpacked` for host entry, pinned Pi packages, correct `.node` files, WASM, and worker entry.
- Launch the packaged app and create a real fixture runtime.
- Exercise one text prompt with a local fake provider, one extension UI cancel, one session switch, one image resize/worker path, host crash/restart, and app quit.

### Step 6: Performance decision

Collect at least five warm samples after one cold sample for:

- current CLI cold start;
- first embedded runtime;
- second same-cwd runtime;
- same-cwd `switchSession`;
- different-cwd runtime/switch;
- 1, 4, and 8 idle runtimes RSS;
- one streaming runtime plus seven idle runtimes;
- host crash recovery.

Proceed only if observed values support the product claim. Otherwise retain Utility Process but revise the goal from “load once” to the measured improvement, or change the pool topology.

## Acceptance Matrix

| Area | Pass condition | Blocking? |
| --- | --- | --- |
| Electron/Node compatibility | Packaged host reports Electron 43.3.0 and Node satisfying Pi's declared engine; SDK import succeeds. | Yes |
| ESM entry | Development, `electron-vite build`, and packaged ASAR all resolve and start the same generated host entry. | Yes |
| MessagePort clone safety | All shared DTO fixtures round-trip; uncloneable values become typed diagnostics; no raw SDK object crosses. | Yes |
| MessagePort pressure | A paused receiver cannot cause unbounded queue/RSS growth; responses/lifecycle are preserved. | Yes |
| Native/WASM | Correct `.node`/WASM files are packaged and runtime-loaded on each release platform. | Yes |
| Nested Worker | Pi image-resize worker works from packaged layout, or an explicitly tested non-blocking alternative is implemented. | Yes |
| Extension loading | Representative JS, TS/Jiti, npm, UI, child-process, and native cases have recorded outcomes. | Yes |
| Performance | Same-cwd and cross-cwd plugin/runtime costs are measured; PRD claims match evidence. | Yes |
| Memory | RSS/PSS measured at 1/4/8 runtimes; no “one 312 MiB host” claim without measured per-runtime slope. | Yes |
| Crash | Host death rejects pending work once, marks all runtimes, clears UI requests, and restarts without replaying mutations. | Yes |
| Shutdown | Normal and hung-host quit finish within a bounded deadline on macOS, Windows, and Linux. | Yes |
| Projection parity | Supported command/response/event/UI corpus matches pinned official RPC behavior and ordering. | Yes |
| Existing UI | Renderer IPC/DTO contract remains stable and no stale generation event appears after switch/restart. | Yes |

## Recommendation

Adopt the user-selected direction with this qualification:

- **Architecture choice:** `utilityProcess` + MessagePort + pinned bundled Pi SDK is technically viable and is preferable to `worker_threads` or a new generic child-process host for PiPilot's selected design.
- **Implementation sequence:** first deliver a narrow feasibility spike covering packaging, SDK import, one runtime, one MessagePort command/event round trip, one extension UI cancel, one session switch, crash, and shutdown. Do not begin the full pool or 650-line projection until the spike is green on all three target operating systems.
- **Transport:** use one validated multiplexed MessagePort with app-level credit/backpressure and generation/sequence correlation.
- **Projection:** preserve PiPilot's existing renderer DTOs, but parity-test against the pinned Pi official RPC implementation. Never post raw SDK values.
- **Packaging:** pin Pi as a production dependency, keep the host entry in ASAR, inspect actual artifacts, and explicitly unpack any native/WASM/worker resources that automatic detection misses.
- **Performance:** treat “2.3 s once” and “one 312 MiB host” as hypotheses until same-cwd/cross-cwd timings and 1/4/8-runtime memory measurements pass.

## External References

Primary/official sources inspected:

- Electron Utility Process API: https://www.electronjs.org/docs/latest/api/utility-process
- Electron MessagePortMain API: https://www.electronjs.org/docs/latest/api/message-port-main
- Electron Message Ports tutorial: https://www.electronjs.org/docs/latest/tutorial/message-ports
- Electron ESM guide: https://www.electronjs.org/docs/latest/tutorial/esm
- Electron ASAR archives: https://www.electronjs.org/docs/latest/tutorial/asar-archives
- Electron native Node modules: https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules
- electron-vite worker/Utility Process entry guide: https://electron-vite.org/guide/dev
- electron-vite build/dependency externalization guide: https://electron-vite.org/guide/build
- Node Worker Threads: https://nodejs.org/api/worker_threads.html
- Node Child Process IPC/serialization: https://nodejs.org/api/child_process.html
- Installed Electron 43.3.0 declarations: `node_modules/electron/electron.d.ts`
- Installed electron-builder 26.15.7 declarations: `app-builder-lib/out/options/PlatformSpecificBuildOptions.d.ts`, `app-builder-lib/out/configuration.d.ts`
- Installed Pi 0.84.2 package artifact: `@earendil-works/pi-coding-agent/package.json`, `docs/sdk.md`, `dist/core/*`, `dist/modes/rpc/*`

## Related Specs

- `.trellis/spec/backend/index.md`
- `.trellis/spec/backend/local-pi-rpc.md`
- `.trellis/spec/backend/service-patterns.md`
- `.trellis/spec/backend/type-and-validation-patterns.md`
- `.trellis/spec/backend/quality-guidelines.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`
- `.trellis/spec/guides/code-reuse-thinking-guide.md`

## Caveats / Not Found

- No Utility Process prototype was added or executed in this research step; only installed-runtime probing and source/document inspection were performed.
- Native packaged execution was not exercised with Pi embedded because Pi is not yet a project dependency.
- The current PRD contains a contradiction: bundled SDK pinning is a confirmed decision and core requirement, but its Out Of Scope section also lists “Bundled SDK pin.” Planning artifacts must resolve that before final review.
- The current design's “2.3 s paid once,” “~ms switch,” and “one 312 MiB host” values are not established by Electron or Pi SDK contracts and remain experiment outcomes.
- Extension compatibility with arbitrary user-installed native modules cannot be guaranteed in advance because the host uses Electron's Node ABI, not necessarily the Node ABI that built the user's local Pi/plugin installation.
- Electron's `UtilityProcess.kill()` API does not expose the same signal-selection controls as `ChildProcess.kill(signal)`; cross-platform hard-kill behavior needs a targeted experiment.
