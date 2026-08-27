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
- Main projects retained Runtime state as bounded `{ scope, sessionId,
  selectionToken?, status }` markers. Paths remain Main-only. Live lifecycle is
  running; idle is completed unless the last assistant stop reason is error,
  which is failed. Publish the projection only for lifecycle/outcome changes,
  not for each `message_update` token.
- The public SDK queue APIs expose queued text but not queued image payloads.
  `promote_follow_up` therefore accepts only Renderer-retained rich payloads,
  validates their exact text arrays against `getSteeringMessages()` and
  `getFollowUpMessages()`, clears and rebuilds through public `clearQueue()`,
  `steer()`, and `followUp()` calls, verifies order, and rolls back on failure.
  Unknown, reconnected, or ambiguous queues must be rejected before mutation.
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
  `runtime.dispose`, `runtime.extension_ui_response`). UI envelopes share the
  bounded per-Runtime flow/credit window with Runtime events and must be
  acknowledged after Main finishes or intentionally drops them.
- The bridge exposes a plain-text headless Theme plus working message and
  visibility. Invoked TUI-only methods emit bounded, deduplicated runtime
  observations; component factories are never executed in Main or Renderer.
- `RuntimeManager.bindSessionEvents()` is the event projection boundary. It
  projects the official SDK event once through `projectRuntimeEvent()` and
  emits only validated `LocalPiRpcEvent` DTOs. A non-transport projection
  defect emits the fixed `{ type: 'runtime_diagnostic', code:
  'RUNTIME_EVENT_PROJECTION_FAILED' }` event for that Runtime and continues
  listening; it must not notify Host-fatal listeners. The renderer treats this
  diagnostic as sequence uncertainty and requests an authoritative snapshot.
  Utility shutdown, MessagePort/transport failure, Host bootstrap failure, and
  extension-requested shutdown remain Host-fatal.

### Stale Runtime event/UI forwarding

#### 1. Scope / Trigger

This applies whenever `PiRuntimeFrontend` receives a Host `event` or
`ui_request` while a Runtime is being replaced, retired, rebound, or has
already fallen out of the current Host snapshot.

#### 2. Signatures

- `forwardEvent(envelope: PiHostEventEnvelope): Promise<void>`
- `forwardUiRequest(envelope: PiHostUiRequestEventEnvelope): Promise<void>`
- Host acknowledgement: `pool.acknowledgeEvent(envelope)` exactly once.

#### 3. Contracts

- Validate the tracked Runtime generation and obtain a current control handle
  before applying activity or invoking all-Runtime listeners.
- A `PI_RUNTIME_STALE_GENERATION` result means the envelope is superseded and
  must be dropped; it must not reach selected or all-Runtime UI consumers.
- Every accepted envelope is acknowledged in a `finally` path, including stale
  and malformed events. The subscription callback must consume the forwarding
  Promise so a stale request cannot become an unhandled rejection.
- Current Runtime envelopes retain existing listener ordering and active-event
  adoption behavior.

#### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Runtime ID/generation is not tracked | Drop and acknowledge; no listeners |
| Host snapshot no longer exposes the tracked Runtime | Drop and acknowledge; no unhandled rejection |
| `controlHandleFor` reports stale generation | Drop and acknowledge exactly once |
| Current handle is valid | Apply activity, invoke listeners, then acknowledge |
| Listener throws/rejects | Isolate listener, still acknowledge |

#### 5. Good / Base / Bad Cases

- Good: a delayed extension confirmation from the old generation is ignored
  after Session replacement and its Host credit is released.
- Base: a current notification is delivered to the appropriate all/selected
  listeners in order and is acknowledged after listeners settle.
- Bad: call `void forwardUiRequest(envelope)` without a rejection handler, or
  call `controlHandleFor()` before checking that the Host snapshot still owns
  the Runtime.

#### 6. Tests Required

- Unit-test a UI request emitted after the Runtime summary changes to
  `stopping`/missing: assert no selected/all listener receives it, exactly one
  acknowledgement is recorded, and the test process sees no unhandled rejection.
- Keep current-generation UI and event ordering tests green.

#### 7. Wrong vs Correct

Wrong: `void this.forwardUiRequest(envelope)` followed by an unchecked
`controlHandleFor()` call.

Correct: consume the forwarding Promise, treat stale handles as a dropped
envelope, and acknowledge from `finally` exactly once.

### Provider-safe Runtime message projection

#### 1. Scope / Trigger

This applies when official Pi messages are finalized or projected into a
provider request. Pi `0.84.2` may represent image-only input as
`[{ type: 'text', text: '' }, image]`; OpenAI-compatible endpoints can reject
that history even when the current prompt is non-empty.

#### 2. Signatures

- `sanitizeRuntimeFinalizedMessage(message: AgentMessage): AgentMessage`
- `sanitizeRuntimeProviderContext(messages: readonly AgentMessage[]): AgentMessage[]`
- `PIPILOT_RUNTIME_MESSAGE_SANITIZER_EXTENSION: InlineExtension`

#### 3. Contracts

- `RuntimeManager` appends the hidden sanitizer to `extensionFactories` and
  restores it as the final extension after any caller `extensionsOverride`.
- The `message_end` handler removes whitespace-only text blocks before new
  standard-role messages enter Pi state and Session persistence.
- The `context` handler performs the same projection before every provider
  request, so persisted malformed history is usable without editing JSONL.
- Preserve images, tool calls, thinking blocks, non-empty text, timestamps,
  role, and role-specific metadata. If a standard-role message becomes empty,
  insert a stable non-empty role-appropriate text fallback.
- Omit empty custom/UI-only messages from provider context. Do not send them as
  empty user text through Pi's `convertToLlm()` projection.
- Sanitization is pure. Unchanged messages and contexts retain identity; the
  recovery path never opens, deletes, or rewrites an existing Session file.

#### 4. Validation & Error Matrix

| Input | Required result |
| --- | --- |
| Empty text plus image | Remove only empty text; preserve image |
| Historical malformed entry plus current non-empty prompt | Sanitize history; preserve current prompt exactly |
| Empty user/assistant/tool result with no other blocks | Insert stable non-empty fallback |
| Empty custom string or array | Omit from provider context |
| Non-empty message/context | Return original identity |
| Caller reverses or filters extension order | Sanitizer remains hidden and last |

#### 5. Good / Base / Bad Cases

- Good: an old image-only Session followed by `continue` reaches the provider
  with the image and current prompt, without an empty text block.
- Base: ordinary text, image, thinking, and tool messages pass through without
  content or identity changes.
- Bad: repair the user's JSONL in place, drop the image with the empty text, or
  let a later extension reintroduce invalid content after sanitation.

#### 6. Tests Required

- Unit-test image-only finalized messages and assert the source object is not
  mutated.
- Unit-test historical empty text plus a later prompt and assert only the bad
  block changes.
- Unit-test empty tool fallback, empty custom omission, and unchanged identity.
- Create a Runtime with caller extensions and an `extensionsOverride`; assert
  the hidden PiPilot extension is last.

#### 7. Wrong vs Correct

Wrong: pass `AgentSession.messages` directly to an OpenAI-compatible provider
or rewrite the developer's Session file to remove a malformed block.

Correct: sanitize at the official `message_end` and `context` extension seams,
append the hidden extension last, and leave persisted history untouched.

### Stuck command cancellation and same-Session recovery

#### 1. Scope / Trigger

This applies when an accepted prompt, tool, or extension operation does not
settle and the user invokes `abort`, or when the selected Host has already
entered `crashed` before the abort reaches Utility.

#### 2. Signatures

- `RuntimeManager.command(runtimeId, command, expectedGeneration?, timeoutMs?)`
- `PiRuntimeFrontend.request(command, timeoutMs?)`
- `PI_RUNTIME_ABORT_GRACE_TIMEOUT_MS = 5_000`

#### 3. Contracts

- Ordinary Runtime commands remain serialized by exact Runtime. If the SDK
  reports `session.isStreaming`, `abort` bypasses that queue and calls
  `session.abort()` before session-directory or other command work.
- Main accepts `abort` for an active `ready` or `crashed` Runtime; every other
  Renderer command still requires `ready`.
- Abort uses at most the five-second grace timeout. Controller request timeout
  is the hard Utility reclamation boundary when SDK/tool cancellation cannot
  settle.
- Utility may report `RUNTIME_OPERATION_TIMEOUT` before Main observes the
  corresponding Host failure. That diagnostic, `HOST_RUNTIME_TIMEOUT`, and a
  resulting `HOST_CRASHED` all enter the same recovery path: restart the exact
  Host and hydrate the captured conversation scope, last credible
  `sessionFile`, and selection token. Return abort success only after that
  hydration reaches `ready`.
- Recovery never replays the interrupted Prompt, queue item, tool, or extension
  command. Renderer may accept the fresh Runtime generation only for the abort
  response and continues from the hydrated official Session.

#### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Streaming command is still pending | Dispatch abort outside its command tail |
| Abort settles within grace | Keep the existing Host and Runtime |
| Abort times out or Host is already crashed | Hard-reclaim Host and hydrate the same Session file |
| Same-Session recovery fails | Return terminal `PI_RUNTIME_HOST_RECOVERY_FAILED` |
| Ordinary command targets crashed Runtime | Reject; do not infer recovery or replay |
| Session file is unavailable | Recover only from the captured credible target; never guess another Session |

#### 5. Good / Base / Bad Cases

- Good: a stuck tool is aborted, its Host is reclaimed after five seconds, the
  same Session file opens ready, and a later `continue` prompt succeeds.
- Base: a cooperative SDK abort settles promptly without replacing Runtime.
- Bad: queue abort behind the stuck prompt, retry the prompt after restart, or
  report abort success while the replacement is still loading.

#### 6. Tests Required

- Unit-test that abort preempts a pending streaming Runtime command.
- Unit-test crashed-Host abort recovery, the grace timeout, same `sessionFile`,
  fresh Runtime identity, and zero replayed prompt commands.
- Electron-test fatal Host shutdown -> abort -> same file ready -> following
  prompt produces an official assistant response.

#### 7. Wrong vs Correct

Wrong:

```ts
return enqueue(runtime, () => session.abort())
```

Correct:

```ts
const operation = command.type === 'abort' && session.isStreaming
  ? dispatchAbortImmediately()
  : enqueue(runtime, dispatchOrdinaryCommand)
```

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
| Official tool result omits `details` (including successful `write`) | accept the DTO; `details` is optional and JSON-omitted when undefined |
| One non-transport SDK event cannot be projected | emit the fixed Runtime diagnostic, keep the Host and sibling Runtimes alive, then allow later valid events |

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
- The Electron and packaged SDK workflows execute the official `write` tool,
  whose successful result has `details: undefined`, and assert that DTO
  projection omits the field without clearing selection, stopping the Runtime,
  or preventing a following prompt.

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
