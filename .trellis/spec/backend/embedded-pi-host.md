# Embedded Pi Host Contract

## 1. Scope / Trigger

Use this contract whenever Electron Main composes, schedules, or restarts the
embedded utilityProcess hosts that execute the bundled
`@earendil-works/pi-coding-agent` SDK, or when shared IPC forwards Pi RPC
commands, events, sessions, or extension dialogs to the renderer. PiPilot owns
the RPC projection and all process/session lifecycle; Pi remains the owner of
auth, models, packages, extensions, tools, sessions, and Agent semantics.

## 2. Topology

- Every runtime executes in an Electron `utilityProcess` (`src/main/pi-host/
  pi-host-utility.ts`) that imports the exact bundled Pi SDK. No CLI spawn, no
  executable discovery, no JSONL text framing.
- Main ↔ Host uses transferable `MessagePort` objects with structured-clone DTO
  envelopes (`src/shared/pi-host-protocol.ts`): kind, host epoch, runtimeId,
  runtimeGeneration, requestId / sequence, and a 64 MiB bounded payload. Raw SDK objects,
  extensions, functions, streams, and Electron objects never cross the port.
- One primary Host per canonical project cwd plus one projectless cwd. Production
  has no fixed Host or per-Host Runtime count. Unrelated project cwd values never
  share a Host; each Host is forked with the scope cwd.
- Hosts hold retained Runtime registries keyed by `runtimeId` (regex
  `^rt_[A-Za-z0-9_-]+$`). Runtime generations are per-Runtime; the Main
  `PiRuntimeFrontend` publishes snapshots whose generation equals the
  active Runtime generation. Selecting another Runtime may therefore move the
  visible generation from a larger number to a smaller one. Main filters Host
  events by `runtimeId` before publishing the selected snapshot; downstream
  stores must not reject that snapshot solely because its numeric generation
  is lower than the previously selected Runtime.
- Host crash is the authoritative runtime-failure boundary outside a controlled
  activation transaction. During `start`/`replace`, the candidate Runtime may
  be intentionally absent from one pool snapshot while failed partial state is
  disposed or rebound; that transient absence must not synthesize a Host crash
  or evict other healthy cached Runtimes in the same Host. After the activation
  transaction ends, a real missing/crashed active Runtime produces the usual
  terminal `crashed` snapshot so no spinner or stale dialog survives.
- A fatal Utility path best-effort emits one bounded `host_failure` envelope
  for the current Host epoch before closing. `PiHostController` preserves that
  first diagnostic; later MessagePort-close or process-exit symptoms must not
  replace it. The envelope contains only a stable sanitized error DTO, never a
  stack, cwd, Session path, prompt, credential, or arbitrary thrown graph.
- A crashed scope entry is recoverable only on the next explicit Session
  activation. `ProjectHostPool` retires the exact crashed controller and all of
  its Runtime ownership/leases, then uses one per-scope single-flight transition
  to create a fresh Host. Concurrent opens join that transition. Background
  snapshots never start a recovery loop, and accepted prompts, queued work,
  tools, mutations, or extension responses are never replayed.
- Session catalog rows are read-only navigation metadata. Listing or paging the
  catalog never starts a Host or allocates a Runtime. Activating a new Session
  creates a Runtime; reselecting an activated Session reuses its retained
  Runtime when available and otherwise recreates it from the unchanged
  persisted Session.
- Active Runtimes have no fixed count and are never evicted for cache or memory
  pressure. Durably persisted inactive Runtimes use a bounded per-Host LRU
  cache. Main tracks prompt/tool/queue/retry/compaction/summarization/extension
  UI activity and revalidates official `get_state` under the lifecycle queue
  immediately before disposal. Failed validation or new activity keeps the
  Runtime. Sessions without a durable file are pinned.
- Runtime reclamation releases SDK memory only; it never deletes, moves, or
  hides the Pi-owned Session file or catalog row. MessagePort envelope,
  pending-request, event-credit, and payload bounds remain enforced separately.
- External Control acquisition uses the same retained Runtime owner. A control
  handle increments `controlPins` for cached and cold acquisition, is
  generation-safe and idempotently releasable, and prevents idle reclaim
  through acquisition/submit gaps. Submission failures release in `finally`;
  accepted prompt/queue activity becomes the authoritative retention signal.
- Real process spawn or SDK allocation failures retain their typed diagnostics;
  there is no artificial capacity error or numeric-limit queue.

## 3. Main seam

- `PiRuntimeFrontend` (`src/main/pi-host/pi-runtime-frontend.ts`) exposes the
  LocalPi-runtime-shaped surface: `getSnapshot/subscribe/subscribeEvents/
  subscribeUiRequests/start/replace/restart/stop/request/respondToExtensionUi/
  getState/renameSession/dispose`. `start`/`replace` bind the exact requested
  Session, reusing a retained Runtime when its scope/Session lease still
  matches and otherwise creating a candidate transactionally. `stop` disposes
  the selected Runtime and keeps the Host warm.
- Main-only control methods acquire/list/submit/abort/subscribe against exact
  handles without changing Renderer selection. `runtime.external_submit` is a
  Host-internal command in the exact Runtime lane: `auto` selects Prompt only
  when idle and Follow-up only when running; explicit Prompt/Follow-up/Steer
  preserve SDK validation and never infer acceptance from later events.
- The selected Runtime is a renderer projection, not an ownership transfer.
  Every command captures its exact Runtime/generation before awaiting and is
  serialized only with commands for that Runtime. Selecting or creating
  another Session does not abort, dispose, or redirect an accepted command;
  background events continue updating Main activity and return Host credit
  without being projected into the newly selected transcript.
- `request()` re-hydrates the snapshot after session-changing commands
  (`new_session/switch_session/fork/clone/set_session_name/import_session`).
- An SDK `SessionManager` creates its Session directory during construction but
  does not recreate it before later appends. Before every SDK command dispatch,
  `ensureRuntimeSessionDirectory(session)` must recursively restore the exact
  directory returned by `session.sessionManager.getSessionDir()` with mode
  `0700`. Do not derive a parallel path or create a replacement Session. A
  restore failure is returned as the command's bounded failure response.
- Session rename is a Main catalog capability. Resolve the opaque selection
  token, then rename through the exact owning Runtime when retained or through
  `SessionManager.open()` in its canonical Host when inactive. Do not activate
  the row, expose its file path, or retarget another Runtime.
- Session activation is serialized and has one bounded retry for recoverable
  Host/generation/hydration races. A failed candidate Runtime is disposed
  without discarding the previously healthy active Runtime. If retry also
  fails, the caller receives a terminal typed error; when a prior active
  Runtime still exists, Main restores its ready snapshot instead of publishing
  a false empty/crashed state.
- A Host recovery failure maps to the terminal
  `PI_RUNTIME_HOST_RECOVERY_FAILED` error for that activation and is excluded
  from the generic retry path. A later explicit activation may try once again;
  the failed click itself must settle as ready or error and cannot leave a
  Session row loading indefinitely.
- Consumers in `src/main/index.ts` (catalog activation, conversation context,
  session deletion, MCP/models config controllers, integrations service) type
  their dependency as `Pick<PiRuntimeFrontend, ...>`; there is no
  compatibility facade or silent legacy fallback.
- Main keeps owning catalog paths, selection tokens, session-header
  validation, observed directories, and event ordering. The removed
  executable-discovery/prerequisite surface (`requireLocalPiExecutable`,
  `piExecutablePath` persistence) is not re-introduced.

## 4. Renderer boundary

- `window.pipilot.localPi.runtime.*` keeps the validated LocalPi DTO shapes
  (command / rendererReady / restart / status / subscribe / subscribeEvents /
  subscribeExtensionUi / respondToExtensionUi); `rendererReady` triggers a
  no-arg `conversationContextService.start()` — Main no longer starts Pi at
  app launch.
- The `localPi.pool.*` and `localPi.executable.*` IPC surfaces and channels
  are deleted. Events are enriched with generation at the IPC edge.
- `get_tree` responses are projected iteratively (explicit stack, node/depth
  bounds) in `src/main/ipc/projection/pi-rpc-response-projection.ts`, which
  is preserved from the removed local-pi backend; `projectLocalPiRendererRpcResponse`
  failures are `PiRuntimeFrontendError(PI_RUNTIME_OPERATION_FAILED)`.
- Extension UI blocking dialogs (select/confirm/input/editor) arrive as
  `extension_ui_request` envelopes through `subscribeExtensionUi`; responses
  travel the runtime-scoped `runtime.extension_ui_response` command
  (`runtimeScoped` whitelist: `runtime.reload`, `runtime.command`,
  `runtime.dispose`, `runtime.extension_ui_response`). UI envelopes bypass the
  event credit window.
- The bridge exposes a plain-text headless Theme plus working message and
  visibility. Invoked TUI-only methods emit bounded, deduplicated runtime
  observations; component factories are never executed in Main or Renderer.

## 5. Bundled config management

- `pi-management-helper` imports the bundled SDK directly
  (`VERSION/getAgentDir/SettingsManager/DefaultPackageManager`); executable
  paths and package-locator resolution are gone. Management commands carry
  only `protocolVersion/operationId/cwd/scope`. CJS `require()` of the pinned
  package throws `ERR_PACKAGE_PATH_NOT_EXPORTED`; use ESM `import()`.
- `LocalPiIntegrationService` identities are the bundled SDK version plus
  scope; summary `executable` is `{ path: 'bundled', version }`.
- One shared package adapter registry owns `pi-mcp-adapter`, `pi-subagents`,
  exact-version Plan Mode, and exact-version Goal. Unknown packages remain
  generic and `pi-retry` has no package adapter.
- `pi-mcp-adapter` is the only automatically managed recommendation. Main may
  install it globally through Pi's public package manager with a single-flight,
  best-effort operation. Explicit user removal persists an opt-out; failure is
  diagnostic-only and never blocks Host startup or chat.
- The already-running utility process sets its child-process
  `ELECTRON_RUN_AS_NODE` environment before extensions load. This supports
  `pi-subagents` without rewriting third-party files under `node_modules`.
- Goal is user-managed. Main classification requires the exact npm identity and
  supported version; Renderer additionally requires matching official `goal`
  command provenance before consuming bounded `goal-state` Session data.
- Package mutations reload affected Runtime resources first through the public
  SDK. A reload failure may fall back to restarting the same affected Host set;
  failed synchronization leaves a durable restart marker visible.
- Helper mutation timeouts: `DEFAULT_TIMEOUT_MS=120s`,
  `DEFAULT_MUTATION_TIMEOUT_MS=10min`, `killGraceMs=500`, 2MB records, 8MB
  output, 16KB stderr, 2000 records.

## 6. Validation & error matrix

| Condition | Required result |
| --- | --- |
| SDK or Host import fails / Host crashes | `crashed` snapshot synthesized for the active primary runtime; no stale dialogs persist |
| Utility emits `host_failure`, then its port/process exits | preserve the first current-epoch sanitized failure; close/exit callbacks cannot overwrite it |
| User explicitly opens a Session in a crashed scope | retire the exact crashed Host once, join concurrent opens to one replacement, hydrate the requested persisted Session, and never replay old work |
| Replacement Host fails during that activation | return `PI_RUNTIME_HOST_RECOVERY_FAILED` once; do not loop, auto-retry, or leave loading active |
| Stale retired-Host callback arrives after replacement | ignore it by controller/entry identity; it cannot crash or mutate the replacement |
| Active runtime absent during a controlled activation/rebind cleanup | Do not synthesize a crash or drop sibling cached Runtimes; retry/restore through the activation transaction |
| Active runtime not found after activation transaction ends | standard crash semantics apply |
| Foreground selection changes while another Runtime command is pending | keep the command bound to its captured Runtime; do not stop it or publish its completion into the new selection |
| User reselects a retained running Runtime | hydrate and select that exact Runtime; keep its running/Stop state |
| Rename targets an inactive catalog row | rename the exact token-selected Session without activation; invalidate only its scope |
| SDK-reported Session directory was removed while its Runtime remains active | recreate that exact directory before dispatch, then execute the command normally |
| SDK-reported Session directory cannot be restored | return the command's bounded failure response; do not report acceptance or replace the Session |
| `get_tree` exceeds node/depth bounds | `PI_RUNTIME_OPERATION_FAILED` protocol-equivalent rejection |
| Session-changing command succeeds but confirming `get_state` fails | `PI_RUNTIME_CONFIRMATION_FAILED` |
| Stale generation | `PI_RUNTIME_STALE_GENERATION` |
| Unknown dialog response | silent no-op (dialogs settle exactly once by UUID) |
| Host/Runtime id invalid | `RUNTIME_TARGET_INVALID` |

## 7. Versions

- Bundled SDK: exact `@earendil-works/pi-coding-agent@0.84.2` in production
  dependencies. `SUPPORTED_PI_VERSION = '0.84.2'` in `src/shared/local-pi.ts`.
- Host protocol version: `PI_HOST_PROTOCOL_VERSION=2` in
  `src/shared/pi-host-protocol.ts`; expected handshake `PI_HOST_EXPECTED_SDK_VERSION='0.84.2'`.

## 8. Verify

1. `pnpm exec tsc --noEmit` clean.
2. `pnpm test:unit` full suite.
3. `pnpm build` (index + pi-host-utility + pi-management-helper entries).
4. Packaged platforms (macOS arm64/x64, Windows x64, Linux x64) plus the
   1/4/8-runtime memory benchmark are CI/device activities.

Host-failure regression coverage:

- Protocol/Utility/controller unit tests assert one sanitized current-epoch
  `host_failure`, first-fault preservation, and close/exit races.
- Pool/frontend tests assert same-scope single-flight recovery, stale callback
  isolation, replacement failure, healthy cross-project retention, and no
  replay.
- Electron tests trigger one isolated fatal extension shutdown and assert the
  next explicit Session activation reaches ready.
- The macOS arm64 packaged GUI test keeps one Runtime executing, exceeds the
  four-idle-Runtime cache with six persisted Sessions, cold-opens an evicted
  Session, then forces a Host shutdown and verifies one-click recovery and
  persisted-history hydration. This proves the recovery contract, not the
  unknown trigger from a user's earlier installed build.

Session-directory regression coverage:

- `tests/unit/runtime-command-dispatcher.test.ts` removes the reported nested
  directory and proves the dispatcher helper restores it as a directory.
- The full SDK Electron workflow continues an accepted prompt after project
  activation and verifies persisted Session hydration rather than a fixture-only
  response.

```ts
// Wrong: assume the directory created with SessionManager still exists.
return dispatchCommand(runtime, command)

// Correct: restore the SDK-owned location before any command can persist.
await ensureRuntimeSessionDirectory(runtime.session)
return dispatchCommand(runtime, command)
```

```ts
// Wrong: retain a poisoned Host forever or restart it in a background loop.
if (host.state === 'crashed') throw new Error('HOST_CRASHED')

// Correct: recover once, only for an explicit activation, through the
// per-scope single-flight transaction. Never replay old Runtime work.
const host = await acquireHostForExplicitActivation(scope)
return hydrateExactPersistedSession(host, target)
```
