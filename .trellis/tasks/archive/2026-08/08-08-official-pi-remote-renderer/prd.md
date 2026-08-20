# Adopt Official Local Pi RPC In The Renderer

## Goal

Make documented output from the selected local `pi --mode rpc` process the sole
Agent source of truth in PiPilot, while retaining PiPilot's desktop presentation
and restoring every user-facing capability that official RPC supports.

## Confirmed Facts

- The public Pi package does not export the JSONL subprocess `RpcClient` used by
  its own examples; PiPilot uses the documented JSONL envelopes through the Main
  host instead of importing `PiClient`, `RemoteSession`, PiServer, or private
  `dist/` files.
- RPC 0.84.1 supports prompt/images, steer, follow-up, abort, session switching,
  rename, fork/clone, entries/tree inspection, compaction,
  model/thinking/modes, automatic-retry controls, stats, bash, commands, and
  supported extension UI requests.
- TUI-only `custom()` and component/theme APIs are explicitly degraded in RPC
  mode and cannot be restored without a private protocol or a Pi fork.
- RPC has no complete session-list, delete, or pin command. The state child owns
  a read-only official-session catalog; delete and pin persistence remain absent.

## Requirements

- Add one renderer provider/view adapter for the current runtime generation and
  selected conversation scope/session. It communicates only through the typed
  local-RPC preload bridge and never spawns or imports Pi itself.
- Initialize authoritative view state with `get_state`, `get_messages`,
  `get_available_models`, `get_available_thinking_levels`, `get_commands`, and
  `get_session_stats`; replace it after reconnect, restart, new/open/fork/clone,
  or conversation-scope change.
- Treat `get_available_models` as the complete real configured-model list and
  `get_state.model` as the selected model. Switch only through
  `set_model(provider, modelId)`, then refresh current state and
  `get_available_thinking_levels`; do not synthesize availability, credential
  readiness, or rollback policy.
- Make Models Settings a second presentation of that same official model slice.
  Its thinking options come only from `get_available_thinking_levels`; remove
  hard-coded level arrays, `configured`/invalid-hidden badges, credential forms,
  connection tests, and any data not returned by the active Pi.
- Remove every production model mock/fallback, including browser-only model,
  selected-model, and credential fixtures. The application bootstrap requires
  the Electron preload bridge; if local Pi is unavailable after desktop startup,
  expose an explicit setup state with an empty model list instead of plausible
  fake choices.
- Replace the unbounded Composer model menu with the existing Popover/Command
  primitives: fixed search/header, one-column provider-grouped results, an
  independently scrolling list, collision-aware placement, and viewport-bounded
  width/height. Long official names, IDs, and providers must truncate without
  changing layout and remain available through tooltips/search.
- Apply documented Agent events to transient presentation state, including
  delta assembly from `message_start`/`message_update` and authoritative
  replacement at `message_end`. Accept `entry_appended`, and project
  `session_info_changed`/`thinking_level_changed` into current session state.
  Do not persist a second transcript or retain the legacy PiPilot Agent
  schema/reducer semantics.
- Render official message/tool/progress/error variants through reusable PiPilot
  components with narrow presentation adapters only.
- Keep Composer editable while official state is streaming. Idle submission uses
  `prompt`; during streaming the primary action is always **Queue** through
  `follow_up`, while a split-button menu offers one explicit **Steer current
  task** action through `steer`. Choosing steer affects only that submission and
  never changes the default from queue.
- Keep Stop as a separate fixed-size `abort` button while running. Text, official
  images, and formatted workspace-path context share the same idle/queue/steer
  submission pipeline, disable duplicate acceptance requests, and clear only
  after the corresponding official success response.
- Treat `queue_update.steering` and `queue_update.followUp` as the only detailed
  queue truth. Show a bounded pending-message popover grouped by Steer/Queue,
  seeded with count-only state from `get_state.pendingMessageCount` after
  reconnect until an official queue event supplies details. Do not persist or
  reconstruct pending messages.
- Expose the actual `get_state.steeringMode`/`followUpMode` in that popover using
  segmented `one-at-a-time`/`all` controls backed only by
  `set_steering_mode`/`set_follow_up_mode`.
- Classify slash commands from the current official `get_commands` snapshot.
  During streaming, extension-source commands cannot be queued or steered and
  use a clearly labeled immediate `prompt` action as required by Pi; prompt and
  skill commands remain eligible for queue/steer expansion. Never silently turn
  a rejected queue/steer into another command.
- Map supported actions one-to-one to documented commands: prompt, steer,
  follow-up, abort, new/switch, model/thinking, steering/follow-up modes,
  compact/auto-compact, automatic-retry controls, rename, fork, clone,
  entries/tree inspection, bash, commands, and export where a current UI entry
  remains useful.
- Use the state child's read-only catalog for session navigation and refresh it
  after actions that change the current session or title.
- Render extension dialog requests (`select`, `confirm`, `input`, `editor`) and
  return the matching official response ID. Render fire-and-forget `notify`,
  keyed status/widget, title, and editor-text requests without inventing Agent
  commands.
- Cancel/dismiss pending dialogs on process generation/session replacement and
  ignore late events from old generations.
- Show official extension errors and the documented TUI-only degradation. Do
  not emulate `custom()` or unsupported TUI components.
- Keep local Pi packages/plugins optional: absence of any plugin cannot disable
  core conversations or desktop features. MCP-specific disclosure/routing is
  owned by the MCP sibling task.
- Remove only unsupported legacy Agent surfaces: session delete/pin,
  credential/resource CRUD, custom approvals/model safety, MCP risk review, and
  their renderer side channels.

## Acceptance Criteria

- [ ] Production renderer has no import or runtime dependency on Pi SDK,
      PiServer/PiClient/RemoteSession, private Pi files, or the legacy Worker
      protocol.
- [ ] A connection/reconnect/session switch hydrates from official snapshots and
      late output from an older process generation cannot change current UI.
- [ ] Streaming text/thinking/tool calls assemble from documented delta events,
      and final messages/tool results are replaced by official authoritative
      envelopes without durable duplicate transcript state.
- [ ] Prompt, steer, follow-up, abort, new/open, model/thinking/modes, compact,
      automatic-retry controls, rename, fork/clone, entries/tree inspection,
      bash, command discovery/submission, and session stats work through
      documented RPC in Electron.
- [ ] While Pi is streaming, Composer remains editable; its primary action sends
      exactly one `follow_up`, the explicit split-menu action sends exactly one
      `steer`, Stop independently sends `abort`, and idle submission sends
      `prompt`.
- [ ] Queue is restored as the default after every submission/session change;
      selecting Steer never becomes a sticky or persisted preference. Draft,
      images, and context clear only on official acceptance and remain on error.
- [ ] Pending Steer/Queue text and counts track current-generation
      `queue_update`; reconnect count-only state uses
      `get_state.pendingMessageCount`, and session/process replacement cannot
      retain stale queue details.
- [ ] The pending popover is keyboard accessible and bounded, uses official
      one-at-a-time/all modes, and provides no single-item cancel, edit, reorder,
      or dequeue control absent from RPC.
- [ ] A discovered extension command sent during streaming is clearly an
      immediate official `prompt`; queue/steer remain available for ordinary,
      prompt-template, and skill submissions without an automatic fallback after
      rejection.
- [ ] The model picker contains only identities returned by the active local Pi,
      shows `get_state.model` as selected, sends exactly one official
      `set_model(provider, modelId)` per selection, refreshes thinking levels, and
      retains the prior model while displaying the official error on failure.
- [ ] The model popover is searchable and keyboard accessible, never exceeds
      `min(440px, calc(100vh - 96px))` in height or
      `min(360px, calc(100vw - 24px))` in width, and scrolls only its results for
      long lists such as Amazon Bedrock catalogs.
- [ ] Missing/disconnected Pi shows no mock models; absent Electron preload is
      rejected at application bootstrap. Production has no `WEB_MODELS`,
      `WEB_SELECTED`, `WEB_CREDENTIALS`, mock-data import, or PiPilot credential
      gate in the model path.
- [ ] Composer and Models Settings show the same official selected identity,
      catalog, thinking levels, loading/error state, and switch result; Settings
      contains no hard-coded model capability list or PiPilot credential UI.
- [ ] Supported extension dialogs return correctly correlated value/confirm/
      cancel responses; notices, status, widgets, title, and composer-text
      updates render and clear by their official keys.
- [ ] Installed global and project Pi extensions expose commands and supported
      UI after startup and a controlled runtime restart.
- [ ] TUI-only custom UI is not silently presented as supported, and a broken
      extension produces a visible official error without breaking core Pi use.
- [ ] Session delete/pin and credential/resource/approval/model-safety/MCP-risk
      renderer actions and Main workarounds are absent.
- [ ] React remount, scope replacement, restart, and session replacement
      leave one active subscription set and no orphaned dialogs/listeners.
- [ ] Focused renderer/event/extension tests, Electron supported-workflow tests,
      typecheck, and build pass.

## Out Of Scope

- Copying or vendoring Pi's internal JSONL client.
- Adding a second Agent protocol, persistent transcript projection, or fallback
  to the embedded Worker.
- Shipping demo/mock model data as a production fallback or managing provider
  credentials in PiPilot.
- Supporting a standalone browser/web runtime; React/Vite is only the Electron
  renderer implementation.
- Reproducing TUI-only custom components, theme APIs, header/footer, raw terminal
  input, or tools-expanded state.
- In-place TUI tree-node navigation or manual last-response retry without an
  official RPC command.
- Per-item queue cancellation/edit/reorder/dequeue, durable queue persistence, or
  inferred queue contents because official RPC exposes no corresponding command
  or queue snapshot.
- Adding session delete/pin persistence or managing Pi credentials/packages.
- Implementing MCP configuration UI, composer attachments/context, cost layout,
  or other sibling task surfaces.

## Dependencies And Ownership

This child follows the local-RPC host and session-catalog children. It
owns renderer RPC-derived state, official action wiring, extension UI surfaces,
Agent conversation/session/model presentation (including running Composer,
official queue popover, model picker, and read-only model settings state),
related locales/fixtures/tests,
and removal of the old renderer message semantics. It does not own Main process
transport, obsolete persistence-code deletion, or unrelated desktop UI.

## Risks And Deferred Items

- Streaming deltas require a small transient assembler. Its output is discarded
  and replaced on snapshot/final-message boundaries so it cannot become a
  second durable Agent truth.
- Built-in TUI commands are not returned by `get_commands`; capabilities with a
  documented RPC command use dedicated UI actions. Resource reload uses a
  controlled local-process restart rather than pretending `/reload` is an RPC
  command.
- Envelopes outside the verified latest contract are diagnosed and trigger a
  snapshot refresh when safe; they are not coerced into old message types.
