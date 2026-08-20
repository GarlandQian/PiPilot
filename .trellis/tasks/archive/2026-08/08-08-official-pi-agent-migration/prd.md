# Migrate PiPilot To The Local Official Pi RPC Runtime

## Goal

Replace PiPilot's embedded/custom Agent runtime with the user's locally
installed official Pi CLI in RPC mode, preserve every applicable official RPC
capability, and delete parallel Agent implementations without removing
PiPilot's independent desktop features.

## Confirmed Decisions And Facts

- The local Pi executable is the only mandatory external installation. All
  non-MCP PiPilot features must work with Pi alone and no Pi plugin.
- The product runtime is Electron only. Missing preload never selects a web/mock
  Agent, workspace, model, resource, Inspector, or Settings implementation.
- Launch the selected executable as `pi --mode rpc --approve`. `--approve` is
  Pi's official per-run project-resource trust override, not a PiPilot tool
  approval or safety policy.
- Use documented LF-delimited JSON commands, responses, Agent events, and
  extension UI requests as the only Agent semantic protocol.
- Classify every current custom Agent operation against the official-first audit:
  use the latest official contract, retain only necessary desktop glue, or
  delete it. There is no custom-semantic or compatibility category.
- Do not embed, bundle, download, or fall back to Pi SDK, AgentSession,
  PiServer/PiClient/RemoteSession, private `dist/` code, copied upstream clients,
  or the legacy Worker.
- Planning target is Pi `0.84.1`, latest verified on 2026-08-09. Recheck latest
  before implementation/verification and display the actual selected path and
  version; PiPilot never updates the global installation automatically.
- Local Pi owns credentials, models, tools, sessions, settings, packages,
  extensions, skills, prompts, providers, and Agent behavior. PiPilot preserves
  its normal environment and uses official output.
- Global and project Pi extensions/plugins are supported through normal Pi
  discovery. They are optional; no plugin is allowed to become a prerequisite
  for core conversations or desktop features.
- MCP is optional and requires separately installed `pi-mcp-adapter`. Its
  always-visible Settings disclosure and standard config editor are owned by a
  sibling task; adapter absence is not a runtime error.
- Restore all official RPC-supported behavior: images, steer/follow-up and
  modes, rename, fork/clone, entries/tree inspection, compaction,
  automatic-retry controls, commands, stats, and supported extension UI.
- Remove unsupported/parallel behavior: session delete/pin, credential/resource
  CRUD, custom approval/model-safety policy, MCP risk scanning, sensitive-path/
  environment policy, and Diff mutation/fingerprint behavior.
- Retain baseline correctness: process-generation/request correlation, atomic
  surviving app settings/workspace persistence, canonical workspace containment,
  bounded reads, and bounded current-format session catalog access.
- Delete PiPilot `credentials.json`, `permissions.json`, and
  `resource-preferences.json` ownership from source. Do not inspect or mutate old
  external app data, read/write official auth, or synthesize Pi configuration.
- Project sessions use the explicitly selected project cwd. Projectless sessions
  use `userData/general-chat/workspace`. PiPilot never passes `--session-dir`;
  local Pi owns the effective session location for both.

## Requirements

### Local Executable And Process

- Add persisted explicit executable configuration plus platform discovery for
  desktop launches that lack the user's shell PATH.
- Canonicalize/probe path/version and complete a no-model `get_state` plus
  `get_commands` capability handshake before ready.
- Own one local Pi child for the active conversation scope/session with strict UTF-8 LF
  JSONL framing, request IDs, serialized stdin, bounded stderr diagnostics,
  cancellation/timeouts, crash/restart, replacement, and clean shutdown.
- Preserve local Pi environment/Agent-directory behavior and never inject
  PiPilot credentials/resources or apply Agent-specific environment filtering.

### Official Agent And Extension Behavior

- Support prompt/images, steer, follow-up, abort, new/switch, model/thinking,
  steering/follow-up modes, compact, automatic-retry controls, stats, rename,
  fork/clone, entries/tree inspection, commands, official bash, and optional
  export through documented envelopes.
- Keep the Composer editable while running: idle submissions use `prompt`, every
  running primary/keyboard submission defaults to Queue through `follow_up`, an
  explicit split-menu choice applies `steer` once, and Stop remains a separate
  `abort`. The steer choice is never persisted as the next-submit default.
- Treat `queue_update` as the only detailed queue source and
  `get_state.pendingMessageCount` as count-only reconnect truth. Expose official
  steering/follow-up modes, but do not persist queue bodies or add item edit,
  reorder, dequeue, or per-item cancel behavior.
- Derive configured/selected models from `get_available_models` and
  `get_state.model`, switch through `set_model`, and remove production model
  mocks plus PiPilot credential/model gating.
- Hydrate renderer state from official snapshots, apply documented events to
  transient presentation state, and replace on reconnect/session change. Do not
  maintain a second durable transcript or legacy Agent state machine.
- Render supported extension dialogs and fire-and-forget UI with exact IDs/keys.
  Report extension errors and documented TUI-only degradation without private
  UI protocols.
- Refresh externally changed packages/extensions through controlled local Pi
  process restart followed by state/messages/commands/stats/catalog refresh.

### Sessions And Direct Code Cutover

- Derive the effective official session directory from local Pi's actual
  `get_state.sessionFile`; provide a bounded read-only metadata catalog because
  RPC has no full list command.
- Remove the embedded Worker/supervisor/protocol/reducer/policies/repositories,
  obsolete persisted-state ownership, obsolete UI/contracts/tests/current
  claims, Worker build input, and direct Pi SDK dependencies after cutover.
- Remove production browser/mock branches and obsolete Settings surfaces with the
  cleanup child. Retained Settings must use real Main/AppSettings/official RPC/
  standard MCP sources; disabled placeholders and hard-coded Pi runtime data are
  deleted.
- Add no session import/copy/conversion, prior-schema parser, startup data
  cleanup, or compatibility adapter.
- Preserve workspace/file tree/context, terminal, read-only Diff, settings,
  navigation, appearance, icons/brand, localization, and Electron lifecycle.

## Acceptance Criteria

- [ ] A configurable/discovered canonical local Pi path/version is visible,
      capability-probed, and launched for the active conversation scope as
      `--mode rpc --approve`; missing/incompatible/crashed state is explicit and
      never falls back to embedded Pi.
- [ ] With only local Pi installed and no optional plugin, all non-MCP core and
      desktop workflows remain usable.
- [ ] Strict JSONL framing/correlation, official events/UI requests, stderr,
      timeouts, crash/restart, renderer reattach, workspace/session replacement,
      and shutdown work without private upstream imports.
- [ ] A fixture global extension and project extension expose tools/commands and
      supported dialog/fire-and-forget UI before and after controlled restart.
- [ ] New/open/switch, prompt/steer/follow-up, abort, model/thinking/modes,
      compact/automatic-retry controls, rename/fork/clone, entries/tree
      inspection, commands, stats, images, official bash, and supported extension
      UI work through official RPC in Electron.
- [ ] While Pi is running, Queue is always the default submit action, Steer is
      one-shot, Stop is independent, official queue details/count/modes are
      truthful, and captured text/images/context clear only after acceptance.
- [ ] The bounded searchable model picker contains only models reported by local
      Pi; selection uses `set_model`, thinking levels refresh, and unavailable
      states contain no mock or credential-gated fallback.
- [ ] TUI-only custom UI is accurately degraded; session delete/pin,
      credential/resource CRUD, approvals/model safety, MCP risk review,
      sensitive path/env policy, and Diff mutation are absent.
- [ ] Current project/projectless sessions remain in Pi's own effective storage,
      are cataloged from official `sessionFile`, and no old PiPilot data is read,
      copied, converted, or deleted.
- [ ] No production path/import remains for embedded Agent semantics, direct Pi
      runtime SDK dependencies, custom credential/permission/resource policy,
      or fallback execution.
- [ ] No standalone web mode or production fixture data remains, and Models,
      General, Terminal, MCP, and About Settings reflect only their real Electron/
      Main/Pi sources.
- [ ] Every surviving Agent-facing IPC/store/action cites a latest official Pi
      command/event/resource contract; every other surviving custom module has a
      documented desktop-only ownership reason.
- [ ] RPC correlation, atomic surviving persistence, canonical workspace paths,
      bounded reads, and current session catalog remain after policy cleanup.
- [ ] Focused and full tests, typecheck, Electron/integration/visual checks,
      build, package, real no-model smoke, and packaged explicit-path startup
      pass with actual results recorded.

## Out Of Scope

- Automatic Pi or Pi-package installation/update/removal from PiPilot.
- Reimplementing `pi install/remove/update/list/config` as PiPilot package state.
- Reproducing TUI-only custom components or unsupported session delete/pin.
- In-place TUI tree-node navigation or manual last-response retry, which have no
  current official RPC command.
- Queue item editing, reordering, dequeue, per-item cancellation, durable queue
  persistence, or reconstructing queue bodies from the aggregate reconnect count.
- Credential/resource management, approval/safety/risk policy, or legacy secret
  import.
- MCP server execution/config details owned by the MCP sibling task.
- Standalone browser deployment and unimplemented Settings placeholders.
- Unrelated UI implementation details owned by other umbrella children.
- Publishing, signing, notarizing, or releasing the app.

## Child Tasks And Dependencies

1. `08-08-official-pi-remote-runtime` builds executable discovery and the local
   documented JSONL process host.
2. `08-08-official-pi-session-catalog` consumes the host to discover Pi-owned
   session locations and provide the bounded read-only catalog.
3. `08-08-official-pi-remote-renderer` consumes host/catalog contracts and cuts
   the UI to official snapshots/events/actions/extension UI.
4. `08-08-credential-storage-alternatives` removes credential ownership after
   renderer cutover without an old-data migration.
5. `08-08-remove-legacy-agent-stack` removes all remaining embedded semantics,
   policies, obsolete state ownership, build inputs, and dependencies after sibling Diff
   mutation removal is ready.
6. `08-08-verify-official-pi-remote-migration` runs the final local-RPC,
   structural, Electron, build, package, and explicit-path gate.

## Risks And Deferred Items

- The discovered local Pi was `0.84.0`; the final latest-version smoke requires
  an external update if it remains older than the verified target.
- Future Pi versions may change envelopes. Capability probing and visible
  unknown-envelope diagnostics take precedence over silent coercion.
- Session browsing remains a bounded read-only catalog until official RPC gains
  a complete listing command.
- Extensions using TUI-only `custom()` or component/theme APIs remain degraded
  unless upstream Pi adds corresponding RPC support.
