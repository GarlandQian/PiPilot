# Pi Plugin Lag Refactor

## Goal

Replace PiPilot's production chat runtime from external `pi --mode rpc` JSONL
processes to an exact bundled Pi SDK hosted in Electron `utilityProcess`
processes, connected to Main through `MessagePort`, with a PiPilot-owned RPC
semantic projection. The refactor should reduce repeated startup and switching
latency, preserve the current renderer/session/catalog behavior, and ensure a
cancelled, expired, replaced, or crashed extension UI request cannot leave the
application blocked indefinitely.

## User value

- Session activation and repeat switching should avoid unnecessary executable
  discovery, capability-probe processes, CLI startup, and SDK module import.
- The installed global and selected-project Pi packages, extensions, skills,
  prompts, themes, models, auth, sessions, and context should continue to use
  Pi's official formats and public APIs.
- A plugin dialog or host failure should fail visibly and recoverably instead
  of leaving the conversation spinning or permanently blocked.
- Renderer behavior should remain familiar: the existing loading, transcript,
  session catalog, extension activity, notifications, and Inspector state are
  retained rather than replaced by a second UI system.
- Closing the main window should keep active conversations running in the tray;
  only an explicit application quit or update installation shuts Hosts down.

## Confirmed decisions

The user has explicitly selected all four architectural pillars:

1. **Bundled Pi SDK** — PiPilot ships and imports an exact production-pinned
   `@earendil-works/pi-coding-agent` version.
2. **Electron `utilityProcess`** — the SDK and user Pi extensions execute
   outside Electron Main and Renderer.
3. **`MessagePort` transport** — Main and the utility host exchange validated,
   structured-clone-safe DTOs rather than JSONL text.
4. **PiPilot-owned RPC projection** — PiPilot reproduces the pinned official
   RPC command, event, session-rebind, and extension-UI semantics on top of the
   public SDK. It does not run official `runRpcMode()` internally.

The production result is bundled-SDK-only. The user explicitly approved a
breaking cutover: do not retain the current CLI backend, a compatibility
adapter, or a silent fallback to a locally installed executable. Official Pi
0.84.2 RPC fixtures remain the semantic oracle; the previous PiPilot backend is
not preserved as a product or migration path.

## Confirmed feasibility facts

- Installed Pi `0.84.2` publicly exports `AgentSession`,
  `AgentSessionRuntime`, `createAgentSessionServices`,
  `createAgentSessionFromServices`, `createAgentSessionRuntime`,
  `SessionManager`, `ModelRuntime`, `SettingsManager`, extension APIs, and RPC
  types. These cover PiPilot's current command capabilities.
- Official `runRpcMode()` cannot be redirected to `MessagePort` or instantiated
  once per runtime: it owns stdin/stdout, process signals, shutdown, and a
  never-resolving loop. Its dispatcher, event conversion, and extension UI
  bridge are private closures, so semantic parity must be maintained by
  PiPilot against the exact pinned version.
- Electron `43.3.0` supports ESM utility processes, transferable
  `MessagePortMain` objects, lifecycle events, stdout/stderr diagnostics, and a
  Node version satisfying Pi `0.84.2`'s engine requirement.
- Structured clone is not a safety net for SDK objects. Only bounded plain
  DTOs may cross the port. Raw sessions, extension APIs, functions, streams,
  abort controllers, Electron objects, and arbitrary thrown values must remain
  inside the host.
- `MessagePort.postMessage()` has no drain signal. PiPilot needs bounded queues,
  request correlation, host/runtime generations, event sequence numbers, and
  application-level credit/ack or chunking for large histories and trees.
- Pi creates cwd-bound settings/model/resource services for every runtime or
  replacement. The extension module graph can remain warm, but extension
  factories and extension state are recreated for every runtime. The isolated
  cache spike in `research/extension-cache-spike.md` confirmed this directly.
- The current startup path may initialize Pi twice: one full capability probe,
  then the real conversation process. The new architecture can remove this
  duplication.
- Arbitrary extensions are not process-isolated inside one host. Current real
  packages include process-global state and `process.cwd()` usage; in
  particular, `pi-pretty` has a `globalThis` singleton tied to one cwd.
- Pi's current `message_update` event in `0.84.2` adds cumulative top-level
  `usage`; PiPilot's exact shared schema must be updated as part of the pin.
- The installed Pi dependency closure is large and includes native modules,
  WASM, and a nested image worker. A source build is insufficient proof;
  packaged execution on macOS, Windows, and Linux is a blocking gate.

## Requirements

### R1 — Exact bundled SDK ownership

- Pin one exact Pi SDK version in production dependencies; the first target is
  `0.84.2`, subject only to re-running the same contract review if the pin is
  deliberately changed before implementation.
- Use only public package exports in product code. Do not deep-import
  undocumented `dist/**` modules.
- Continue using Pi's official global agent directory and selected-project
  discovery rules. Do not create PiPilot-specific copies of packages, auth,
  models, resources, or sessions.
- Remove external executable discovery/probing as a production chat
  prerequisite after the embedded backend passes parity and packaging gates.

### R2 — Utility host and MessagePort boundary

- Spawn the host only after Electron is ready and complete a versioned
  handshake before runtime creation.
- Keep Renderer ↔ Preload ↔ Main on the existing validated IPC boundary.
  `MessagePort` is Main ↔ Utility only.
- Every envelope carries host epoch, runtime ID, runtime generation, request ID
  or event sequence, kind, and a bounded payload.
- Validate incoming messages on both ends. Normalize errors to bounded plain
  diagnostics before posting them.
- Bound queues and large payloads. Responses and lifecycle messages are never
  silently dropped; overflow becomes a typed runtime/protocol failure.
- Host exit, port close, protocol failure, or disposal rejects pending commands
  and UI requests exactly once and cannot apply stale events to a replacement.

### R3 — Main/Renderer cutover

- Replace the current `LocalPiRuntimeHost`, pool, executable service, JSONL
  transport, and dependent IPC/store contracts directly with the new Host and
  Runtime model. Do not add a compatibility facade for removed backend APIs.
- Preserve Main-owned catalog selection, scope/cwd validation, authoritative
  session path confirmation, observed session directories, and event ordering.
- Preserve user-visible loading, transcript, catalog, extension UI, and stale-
  data invariants, but allow shared IPC/Preload/Renderer types to change where
  the new multi-Host/multi-Runtime model requires it. Version-specific changes
  remain explicit and centrally validated.

### R4 — RPC semantic parity

- Implement the supported official RPC commands using public SDK methods,
  including prompt/steer/follow-up/abort, models, thinking, queue modes,
  compaction/retry, bash, session stats, messages, commands, entries/tree,
  new/switch/fork/clone, session naming, and export where currently exposed.
- Rebind session subscriptions and extension contexts after every replacement.
- Convert SDK events to the exact plain DTO shapes consumed by PiPilot and test
  them against the pinned official CLI RPC behavior after removing transport
  metadata only.
- Retain iterative bounds for deep trees and bounded handling for large
  transcripts.
- Project the public Pi 0.84.2
  `RegisteredCommand.getArgumentCompletions(argumentPrefix)` contract for every
  compliant extension command. Capability discovery and completion lookup must
  use the exact selected Runtime/Session command, return only bounded plain
  `{ value, label, description? }` DTOs, and time out without exposing SDK
  objects or raw extension errors. Commands without the provider return no
  suggestions; package-specific command names or argument values are never
  hard-coded.
- The Composer keeps `/command ` and replaces only the current complete
  `argumentPrefix`, preserves provider labels/descriptions, and invalidates late
  results on text, scope, Session, or Runtime-generation changes. The existing
  compact full-width picker owns loading/empty/error states and keyboard
  navigation without a global blocking dialog.

### R5 — Extension UI liveness

- Support official RPC-portable dialogs: select, confirm, input, and editor.
- Support one-way portable surfaces already represented by PiPilot: notify,
  status, string widgets, title, editor-text updates, working message, and
  working visibility.
- Provide a plain-text headless Theme object for extensions that format
  portable status text through `ui.theme`; it must never emit ANSI or expose a
  TUI component.
- Match official honest degradation for TUI-only functions and component
  factories; do not attempt to structured-clone or emulate terminal components.
- Record deduplicated runtime observations when an extension actually invokes
  a TUI-only surface. Do not infer that every package containing an extension
  is partially broken merely from its resource count.
- The host owns a maximum deadline for every blocking dialog, including editor
  and requests without a plugin-provided timeout.
- Dismiss, timeout, abort, session replacement, host restart, and crash emit an
  idempotent terminal request state so stale dialogs leave the renderer.

### R6 — Runtime/host topology (confirmed)

- Support concurrent PiPilot tasks without moving plugin execution into Main or
  Renderer.
- Use one long-lived primary utility host for each selected project canonical
  cwd and one separate primary host for the fixed projectless cwd.
- Session catalog rows are persisted navigation metadata. Listing or paging the
  sidebar catalog never creates, reserves, or queues a Host or Runtime.
- Each primary host can own multiple `AgentSessionRuntime` instances, one per
  activated conversation. Every Runtime has
  an independent `runtimeId`, Session file, generation, event sequence, pending
  command set, and extension-UI request namespace.
- Reselecting an activated conversation reuses its existing Runtime while it
  remains in the idle cache; after safe reclamation it creates a replacement
  Runtime from the same persisted Session. Selecting another persisted
  conversation creates another Runtime in the same project Host. A running
  conversation is never evicted, aborted, replaced, or disposed to make room
  for it.
- Production has no fixed active Host or active per-Host Runtime count and no
  numeric-capacity queue. Concurrent top-level tasks may all continue
  independently.
- Durably persisted inactive Runtimes may be reclaimed through a bounded
  per-Host LRU cache. Reclamation takes the lifecycle queue and revalidates
  official `get_state`; a Runtime with a prompt, tool, Bash command, queued
  message, retry, compaction, summarization, extension UI request, or
  extension-owned subagent work is not eligible. If no safe idle candidate
  exists, reclamation is skipped rather than terminating work.
- A Runtime whose Session file is not yet durably present is not eligible for
  automatic reclamation. Reclamation releases SDK memory only and never
  deletes, moves, hides, or invalidates the persisted Session catalog row.
- Other Runtime/Host disposal occurs through explicit product lifecycle
  operations (including stop, delete/release, scope removal, or configuration
  restart), crash/restart recovery, failed partial activation cleanup, or
  application shutdown. Persisted Session files remain Pi-owned.
- Pi extension-owned subagents remain inside their parent Runtime and do not
  allocate PiPilot Hosts.
- An additional concurrently running top-level PiPilot task in the same project
  uses another Runtime in that project's Host; a different project/cwd always
  receives a separate Host.
- Never place unrelated project cwd values in the same utility process.
- Fork each host with its canonical scope cwd so plugins reading
  `process.cwd()` see the correct project.
- Preserve bounded MessagePort envelopes, pending-request queues, event credit,
  and payload validation. These transport safety bounds do not impose a
  conversation concurrency count.
- If the operating system or SDK cannot spawn a Host or allocate a Runtime,
  surface the real failure as a typed diagnostic; do not translate it into an
  artificial capacity error or silently wait on a numeric limit.

### R7 — Bundled package and config management

- Retain an isolated helper for package/config mutations so third-party package
  operations do not block or contaminate active hosts.
- Bind helper identity to the exact bundled SDK version, scope, and cwd instead
  of a discovered executable path.
- Global package/resource/config changes first request an in-place resource
  reload for all affected hosts; project changes reload only the matching
  project host(s). If reload or extension rebinding cannot complete safely,
  restart the same affected host set as a bounded fallback.
- Continue reading and writing official Pi locations and formats.
- Keep one package-adapter registry shared by management classification and
  runtime/renderer enhancement. The first reviewed adapters are
  `pi-mcp-adapter`, `pi-subagents`, exact-version
  `@narumitw/pi-plan-mode`, and exact-version `@narumitw/pi-goal`; unknown
  packages remain on the generic projection.
- Treat `pi-mcp-adapter` as the one PiPilot-managed recommended global package.
  On first Host use, install it through Pi's public package manager with a
  single-flight, best-effort operation. The package remains visible in
  Integrations and ordinary update/disable/remove controls still apply.
  Explicit user removal records an opt-out so later launches do not force the
  package back. Failure is a visible Integrations diagnostic and never blocks
  chat or Session activation.
- Apply the `pi-subagents` Electron/Node spawn compatibility shim inside the
  PiPilot Host environment. Do not rewrite files in the user's installed
  package directory.
- Treat `@narumitw/pi-goal@0.52.1` as a user-managed rich adapter. Bind it to
  the exact npm package and official `goal` command provenance, project the
  current objective from the bounded `goal-state` Session entry, and expose
  lifecycle-valid Status/Pause/Resume/Clear controls through the existing
  prompt path. Never expose the package's internal goal ID or automatically
  install autonomous goal behavior for the user.
- Do not install, recommend, or rich-adapt `pi-retry`. Official Pi Core retry
  settings and events remain the only retry authority; an already-installed
  `pi-retry` package is treated as an ordinary extension.

### R8 — Measurement and staged cutover

- First build a development/test-gated feasibility slice. It must prove
  packaged SDK import, MessagePort lifecycle and pressure bounds, one real
  runtime, one replacement, extension UI cancellation, crash, and shutdown
  before the full command projection replaces production.
- Record separate timings for host import, service creation, package/resource
  resolution, extension module import, extension factory activation, session
  creation/bind, hydration, and renderer-ready commit.
- Compare current CLI and embedded paths with the same sanitized fixture,
  including current CLI with and without its capability probe.
- Set latency and memory budgets only from measured samples. “2.3 seconds paid
  once”, “all later runtimes are milliseconds”, and “one 312 MiB host” are
  hypotheses, not requirements.
- Delete the CLI implementation, executable discovery/probing, JSONL transport,
  obsolete settings, and legacy tests as their new Host equivalents land. Use
  official pinned Pi RPC fixtures—not retained production code—for parity.

### R9 — Session activation and desktop-lifecycle reliability

- Treat `start`/`replace` as an explicit activation transaction. A candidate
  Runtime may be temporarily absent while a failed partial Runtime is disposed;
  pool reconciliation must not classify that state as a Host crash or remove
  healthy sibling Runtimes.
- Retry recoverable Host/generation/hydration activation races once. Dispose
  only the failed candidate; preserve and restore the previously healthy active
  Runtime when it still exists. A second failure must end loading with a typed
  error rather than an indefinite spinner.
- Exercise cold first-click activation, A → B → cached A reselection, large
  persisted sessions, delayed Host startup, transient hydration failure, and
  repeated launches.
- Keep a persistent Electron tray. Closing the main BrowserWindow hides it and
  keeps utility Hosts, Runtimes, extension work, and Terminals alive. Tray Show
  restores the existing window; tray Quit and update installation use the
  bounded shutdown coordinator before the native close is allowed.

## Acceptance criteria

- [ ] The packaged app imports the exact bundled Pi SDK from an Electron utility
      host on macOS arm64/x64, Windows x64, and Linux x64.
- [ ] Native modules, WASM, nested image worker paths, TS/Jiti extensions, npm
      extensions, and external user resource discovery have recorded packaged
      outcomes on every release platform.
- [ ] Main and Utility complete a versioned MessagePort handshake; request,
      event, crash, port-close, timeout, restart, and shutdown paths are bounded
      and generation-safe.
- [ ] All supported commands, responses, events, error shapes, and ordering match
      the pinned official RPC mode in parity tests.
- [ ] Extension command argument completion covers sync/async providers,
      no-provider commands, timeout and output bounds, stale Renderer responses,
      whitespace parsing/replacement, keyboard selection, and a `/goal r` →
      `resume`-style fixture without depending on a real user package.
- [ ] A registered extension command that reports portable UI but creates no
      conversation turn exposes that UI immediately, automatically reveals it
      once, and cannot leave its output hidden behind a future prompt or reopen
      it after the user dismisses the notification surface.
- [ ] No raw SDK or extension object crosses MessagePort, and deliberately
      uncloneable values become typed diagnostics rather than Electron handler
      failures.
- [ ] A paused/slow receiver cannot cause unbounded queue or RSS growth.
- [ ] Session new/open/switch/fork/clone and project/projectless activation retain
      authoritative path/scope checks, immediate loading, full hydration, and no
      stale transcript or Inspector data.
- [ ] Sidebar catalog listing does not allocate Runtimes, and production imposes
      no fixed active Host/Runtime count or numeric-capacity queue. LRU may
      release only durably persisted, revalidated idle Runtimes and never
      removes their Session rows.
- [ ] Extension select/confirm/input/editor requests resolve on response,
      dismissal, timeout, replacement, and crash; late responses are harmless.
- [ ] TUI-only extension surfaces degrade exactly and visibly according to the
      supported compatibility contract.
- [ ] Representative fixtures cover MCP, subagents, exact Plan Mode,
      notifications/widgets/working state, TUI-only diagnostics,
      timers/children, and process-global plugin state. Retry fixtures exercise
      Pi Core only and never require `pi-retry`.
- [ ] Raw timing samples and 1/4/8-runtime memory samples are recorded; the final
      PRD performance claims match those measurements.
- [ ] Global/project package and config operations use the bundled SDK helper and
      restart the correct host set.
- [ ] Production no longer depends on a locally importable Pi executable after
      cutover, and it does not silently fall back to the legacy CLI backend.
- [ ] Relevant unit, Electron, packaged smoke, typecheck, and build checks pass
      for the current worktree.

## Out of scope

- Rendering or executing arbitrary Pi TUI components in Electron.
- Importing private Pi `dist/**` modules to avoid maintaining the adapter.
- A second renderer state model or a new top-level UI for this backend change.
- Fixing the internals of third-party plugins that are incompatible with shared
  process state; PiPilot may isolate or report them instead.
- Rewriting or patching source files inside user-installed third-party package
  directories. Compatibility fixes belong to version-gated PiPilot Host or UI
  adapters.
- Promising latency/RSS numbers before the feasibility benchmark records them.
- Retaining any legacy CLI runtime engine or compatibility adapter after the
  direct cutover.

## Confirmed topology decision

The user approved one project/projectless scope per primary utility host with
multiple Runtime instances inside each Host. Catalog rows do not imply live
Runtime allocation. Production has no fixed active Host/Runtime count; running
work remains independent and cannot be evicted. Durably persisted inactive
Runtimes form a bounded LRU cache and are reclaimed only after activity-state
and official `get_state` revalidation. Unpersisted Sessions remain pinned, and
Runtime reclamation never removes the Session catalog row. Different
project/cwd values never share a Host. This balances uninterrupted concurrency,
memory recovery, correct cwd behavior, and compatibility with process-global
plugin state. Transport queues and payloads remain independently bounded.

## Research evidence

- `research/pi-sdk-feasibility.md`
- `research/electron-utility-host-feasibility.md`
- `research/current-runtime-migration-feasibility.md`
- `research/extension-cache-spike.md`
- `research/extension-cache-spike.mjs`
