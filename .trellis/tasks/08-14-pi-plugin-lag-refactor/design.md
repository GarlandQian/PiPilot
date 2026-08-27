# Design — Pi Plugin Lag Refactor

## Architecture decision

Use the user-selected embedded design:

```text
Renderer ← validated Electron IPC → Main ← MessagePort → utilityProcess Host
                                                   │
                                      bundled Pi SDK 0.84.2
                                                   │
                              retained Runtime registry for one project/cwd
```

The Host boundary is per canonical project scope, not per conversation. A
projectless scope has its own Host. Different project/cwd values never share a
Host. A Host may own multiple SDK `AgentSessionRuntime` instances for
concurrent or previously activated conversations. Reselecting one uses its
retained Runtime; activating another creates another Runtime in the same Host.

This topology preserves correct `process.cwd()` behavior and limits plugin
crash/global-state contamination while still allowing more than one conversation
in a project to run independently.

## Boundaries and ownership

### Main

Main remains the owner of:

- application lifecycle and Host creation/disposal;
- project/projectless scope resolution and canonical cwd;
- session catalog paths, opaque selection tokens, header validation, and
  observed-directory invalidation;
- the direct project Host and Runtime-pool services used by conversation, MCP,
  models, package management, and IPC composition;
- host epoch, Runtime ID/generation, request correlation, crash handling,
  restart/reconciliation, and bounded diagnostics;
- Renderer IPC registration and event ordering.

Main must not pass SDK classes, extension APIs, callbacks, streams, or paths to
the Renderer.

### Utility Host

The utility process owns:

- the exact bundled Pi SDK import;
- a `Map<runtimeId, AgentSessionRuntime>` with no production count limit;
- public SDK runtime creation/replacement/disposal;
- extension discovery, factory activation, extension binding, and SDK event
  subscription;
- the PiPilot-owned RPC command dispatcher and event/UI projection;
- extension UI request deadlines and terminal states;
- clone-safe DTO projection before every MessagePort send.

The Host runs with the project scope cwd. It must not call `process.chdir()` per
Runtime. A Runtime target carries its validated session file and scope identity;
the Host rejects a target whose Session header/cwd does not match the Host scope.

### Renderer

Renderer-facing contracts and `PiRpcProvider` remain stable wherever Pi 0.84.2
is shape-compatible. The existing generation-safe projector, hydration gates,
extension dialog, catalog loading, and Inspector state are reused. Renderer
does not receive a MessagePort and does not load the SDK.

## Runtime registry behavior

Each Host has a Runtime table whose size follows explicit conversation
activation, not the number of rows displayed in the Session catalog:

```text
ProjectHost(cwd=A)
├── runtime-1 → session-1 (streaming)
├── runtime-2 → session-2 (idle/recent)
└── runtime-3 → session-3 (pending extension UI)
```

Rules:

1. Listing or paging persisted Sessions is read-only catalog work and never
   creates or reserves a Runtime.
2. Reselecting an already activated Session uses its existing Runtime while it
   remains cached. If LRU already reclaimed it, selection creates another
   Runtime from the unchanged persisted Session. Selecting another Session
   creates another Runtime in the same Host.
3. A Session with an active prompt, tool, queued steer/follow-up, retry,
   compaction, pending extension UI, or extension-owned subagent work keeps its
   Runtime. Concurrently executing Sessions all continue.
4. Every Runtime has independent command correlation, event sequence, UI
   request namespace, and disposal state. No response is routed by session ID
   alone.
5. Production has no fixed active Host or per-Host Runtime count and no
   numeric-capacity queue. Running Runtimes are never reclaimed to satisfy an
   idle-cache or resource-pressure policy.
6. Durably persisted inactive Runtimes use a bounded per-Host LRU cache. Before
   disposal Main takes the lifecycle queue, checks tracked prompt/tool/queue/
   retry/compaction/summarization/extension-UI activity, then revalidates
   official `get_state`. Any activity change or failed validation cancels the
   reclamation. A Session without a durable file is pinned.
7. Reclaiming a Runtime releases SDK memory only. Persisted Session files and
   their catalog rows are never deleted merely because a Runtime ends. Other
   disposal remains explicit lifecycle, crash/restart recovery, failed partial
   activation cleanup, or application shutdown.
8. Pi extension-owned subagents remain inside their parent SDK Runtime and do
   not consume PiPilot Host slots.
9. A Host crash invalidates every Runtime in that project scope. Main rejects
   pending work once, closes stale UI requests, and may recreate idle persisted
   Sessions after a fresh handshake. It never replays an accepted prompt,
   mutation, tool call, or UI response.
10. Real Host spawn or SDK Runtime allocation failures surface as typed errors;
   they are not converted to artificial capacity failures.

### Activation transaction and failure recovery

`PiRuntimeFrontend.start/replace` owns an explicit activation-depth boundary.
Pool snapshots continue reconciling inactive Runtime descriptors during that
boundary, but the temporary disappearance of the candidate active Runtime does
not trigger Host-crash synthesis or whole-Host cache eviction. The candidate
Runtime is bound and hydrated before commit.

Recoverable operation, stale-generation, or hydration confirmation failures
receive one bounded retry. Failed candidates are disposed independently. If a
previous healthy Runtime still exists, its ready snapshot is restored between
attempts and after the terminal failure; the catalog-open caller still receives
the error and therefore cannot treat the prior snapshot as success for the new
selection.

### Tray-resident application lifecycle

The BrowserWindow close event and application shutdown are separate paths.
Normal close persists the latest window state, prevents native destruction, and
hides the window. A Main-owned Tray keeps the process reachable and exposes
Show and Quit. Show restores/focuses the existing BrowserWindow; Quit enters
`ApplicationShutdownCoordinator`, disposes repositories, Hosts, Runtimes,
Integrations and Terminals, then allows `app.quit()` to close the window. Update
installation uses the same terminal coordinator. `window-all-closed` is not an
implicit quit signal in tray mode.

Same-cwd multi-Runtime support is initially compatibility-tested rather than
assumed. Plugins using process-global singletons, timers, child processes, or
mutable module state may require an explicit compatibility classification.

## MessagePort protocol

Use one multiplexed port per Host. Main transfers a `MessagePortMain` during a
versioned bootstrap; the utility side receives the corresponding parent port.

Envelope shape:

```ts
type HostEnvelope =
  | {
      kind: "request";
      hostEpoch: number;
      requestId: string;
      runtimeId?: string;
      runtimeGeneration?: number;
      command: HostCommand;
    }
  | {
      kind: "response";
      hostEpoch: number;
      requestId: string;
      runtimeId?: string;
      runtimeGeneration?: number;
      result: HostResult;
    }
  | {
      kind: "event";
      hostEpoch: number;
      runtimeId: string;
      runtimeGeneration: number;
      sequence: number;
      event: LocalPiRpcEvent;
    }
  | {
      kind: "credit";
      hostEpoch: number;
      runtimeId?: string;
      throughSequence: number;
    };
```

Both ends parse the envelope with shared Zod schemas. SDK values are converted
to plain records/arrays/strings/numbers/booleans/null before posting. Error
values become bounded `{ name, message, code?, stack? }` diagnostics. Functions,
classes, streams, callbacks, AbortControllers, Electron objects, circular
graphs, and raw Session/extension/model objects never cross the port.

Because `postMessage()` exposes no drain signal, the Host implements bounded
per-Runtime queues and credit/ack windows:

- responses, lifecycle, UI-terminal, and crash events have priority and are
  never silently dropped;
- replaceable token/status deltas may coalesce only where the existing Renderer
  projector permits it;
- entries/tree/messages use bounded chunking and request limits;
- queue byte/count overflow terminates the affected Runtime with a typed
  protocol error and leaves the Host restartable.

## SDK and RPC projection

Use only public root exports from the exact pinned package:

- `createAgentSessionServices`;
- `createAgentSessionFromServices`;
- `createAgentSessionRuntime` / `AgentSessionRuntime`;
- `SessionManager`, `ModelRuntime`, `SettingsManager`;
- `AgentSession` and extension APIs/types.

Do not import private `dist/modes/rpc/**` files. Official `runRpcMode()` is the
parity oracle, not a transport implementation: it owns stdin/stdout, signals,
process exit, and private closures for command dispatch, event conversion, and
extension UI.

Split the maintained projection into:

1. `runtime-command-dispatcher`: maps supported commands to public SDK methods;
2. `runtime-event-projector`: maps SDK events to the existing PiPilot DTOs and
   adds Pi 0.84.2 cumulative `message_update.usage` validation;
3. `runtime-state-projector`: produces bounded state/models/thinking/commands/
   stats/messages/entries/tree snapshots;
4. `extension-ui-bridge`: implements portable RPC UI and host-owned deadlines;
5. `runtime-binding`: re-subscribes and re-binds after every replacement;
6. `host-transport`: validates envelopes, sequence/credit, and crash state.

The existing Main iterative tree projection and Renderer projector remain the
consumer-side safety boundary. The new Host projection must be table-tested
against the pinned official RPC fixture with only transport metadata removed.

### Extension command argument completion

Command argument completion is a public SDK projection, not a package adapter.
`get_commands` advertises only whether each exact registered extension command
exposes `getArgumentCompletions`. A separate bounded Runtime command resolves
that command again from the currently selected Session and invokes the actual
provider with all text after `/command ` as `argumentPrefix`. It accepts only
strict plain `{ value, label, description? }` items, caps field lengths and item
count, and applies a Host timeout. Missing providers return an empty list;
provider failures become stable bounded errors rather than cloned SDK errors.

Renderer request identity is
`{ scopeKey, sessionId, generation, documentRevision, commandName,
argumentPrefix, textBeforeCursor }`. The Store checks Runtime identity after
awaiting the transport, and the Composer checks document identity before
committing rows or editing. Completion replaces only the prefix before the
current caret, so `/command ` and any suffix after the caret remain intact.
ArrowUp/Down/Home/End, Enter/Tab, Escape, IME guards, and accessibility continue
through the existing full-width picker.

An extension command can complete entirely through portable UI without adding
a user message or starting the Agent. Renderer identifies that case only from
the current generation's registered extension-command catalog. After the
command settles, any still-unanchored buffered one-way UI is promoted to the
bounded global notification surface with a one-shot reveal marker and the exact
pending operation is cleared. The notification host consumes that marker while
opening, so later renders cannot reopen it; ordinary prompts continue waiting
for an authoritative response anchor.

## Extension UI bridge

`select`, `confirm`, `input`, and `editor` become correlated Host requests with
`opened → resolved|cancelled|expired|replaced|crashed` terminal states. Main
forwards requests through the existing Renderer IPC. Renderer dismissal is
idempotent; a late response is ignored after Host epoch or Runtime generation
changes.

Portable fire-and-forget surfaces remain `notify`, `setStatus`, string widgets,
title, editor text, working message, and working visibility. The bridge exposes
a headless plain-text Theme whose formatting methods return their input and
whose ANSI methods return empty strings, so portable plugins can format status
copy without importing Pi's private TUI Theme implementation.

Official RPC/TUI-only surfaces remain honest no-op or unsupported results:
custom components, terminal input, component widgets, footer/header factories,
custom editor components, arbitrary UI autocomplete providers, theme switching,
and tool expansion. This does not include the public per-command
`RegisteredCommand.getArgumentCompletions` bridge above. The Host emits one
bounded, deduplicated observation for each unsupported method actually invoked.
PiPilot must not invent a second GUI for these in this task.

Every dialog receives a Host maximum deadline, including editor requests that
do not provide a Pi timeout. Runtime replacement/disposal cancels all pending
requests for that Runtime before invalidating the extension context.

## Package management and restart fan-out

Package/config mutation stays in an isolated helper so package code cannot block
or poison an active Host. The helper is bound to exact bundled SDK version,
scope, and cwd, not a discovered executable path.

- Global package/resource/config changes request resource reload/rebind on every
  affected projectless and project Host after persistence succeeds. Project
  changes target only that project's Host. A failed reload falls back to a
  bounded restart of the same host set and reports the honest outcome.
- The helper and runtime use the same exact Pi package version and official
  global/project paths.
- Renderer package rows never authorize code loading.

### Package adapter registry

One shared registry owns package identity, install policy, runtime preparation,
and optional rich presentation. Matching requires an npm package identity from
the official Pi package snapshot; exact versions are required only when the
adapter consumes version-specific status or payload shapes. Project package
identity continues to shadow global identity.

Initial entries:

- `pi-mcp-adapter`: the only automatically managed recommended package. Main
  performs one best-effort global install through Pi's public package manager,
  keeps the package visible in Integrations, and records a durable opt-out
  after explicit user removal; portable UI/status support and the MCP config
  surface remain available;
- `pi-subagents`: Host compatibility preparation for Electron-as-Node child
  execution, generic portable UI, and explicit TUI-only diagnostics;
- `@narumitw/pi-plan-mode@0.49.3`: existing exact-version rich Plan
  presentation and verified command provenance;
- `@narumitw/pi-goal@0.52.1`: user-managed Goal presentation. Renderer accepts
  only the exact npm package plus matching official `goal` command provenance,
  validates the latest bounded `goal-state` custom Session entry, and exposes
  Status/Pause/Resume/Clear without parsing objective text from notifications.

There is no `pi-retry` adapter. Official Pi retry events and settings own the
retry experience. Adapter hooks must not modify files under third-party
`node_modules`; environment/protocol shims live in PiPilot-owned code.

Automatic installation is intentionally narrow. `pi-subagents`, Plan Mode, and
Goal are never installed on the user's behalf. A failed managed MCP install is
reported as a bounded diagnostic and does not block Host startup or chat.

## Direct breaking cutover

The user explicitly rejected compatibility migration. Implementation replaces
the current CLI/JSONL architecture directly:

- delete external executable discovery/probing and `LocalPiJsonl*` ownership as
  soon as their Host equivalents are connected;
- replace Main, shared IPC, Preload, and Renderer contracts in one coordinated
  cross-layer change rather than adding a legacy facade;
- update conversation, catalog, MCP, models, integrations, and settings callers
  to the new Host/Runtime identities;
- delete obsolete settings, copy, fixtures, and tests instead of maintaining
  migrations for an unreleased runtime format;
- retain official Pi 0.84.2 RPC fixture parity and Session/catalog validation,
  but do not retain the old PiPilot backend as executable code.

Rollback is source-control-level only. Do not add a user-visible or hidden
runtime selector solely to preserve the removed architecture.

## Feasibility and release gates

Before production cutover:

1. Build and package one ESM utility entry; inspect ASAR and unpacked native,
   WASM, and nested-worker assets.
2. Prove MessagePort handshake, clone rejection, bounded pressure, close, crash,
   restart, and shutdown on macOS arm64/x64, Windows x64, and Linux x64.
3. Create a persisted fixture Runtime through public SDK APIs; exercise new,
   open, switch, fork, clone, dispose, and projectless/project activation.
4. Run command/event/UI parity tests against official RPC 0.84.2 fixtures.
5. Run representative plugin compatibility tests: MCP, subagents, retry,
   plan-style commands, presentation/file plugins, timers/children, and all
   portable extension UI dialogs.
6. Measure current CLI and embedded cold/warm timings plus 1/4/8 Runtime RSS,
   heap, external memory, queue depth, disposal time, and host recovery.
7. Complete the direct cutover and remove every obsolete CLI/JSONL path before
   declaring the task complete.

Absolute latency/memory thresholds are set from these measurements, not copied
from the prior hypothesis.

## Known risks

- Arbitrary plugins may retain process-global state or leak resources after
  Runtime disposal; whole-Host restart is the reclamation boundary.
- One Host is a failure domain for all conversations in that project.
- Pi SDK/RPC drift requires exact version pin and parity updates.
- Pi's native/WASM/worker closure may increase release size and require explicit
  `asarUnpack` corrections.
- Electron `UtilityProcess.kill()` does not expose ChildProcess-style signal
  selection; hard-kill behavior needs platform tests.
