# Implementation Plan

## 1. Inventory And Define Renderer RPC State

- Map every current Agent store/action/component to a documented RPC command,
  official presentation field, explicit removal, or unrelated desktop feature.
- Define renderer-owned snapshot/transient-progress/extension-UI types from the
  host's documented plain DTO contracts.
- Keep session catalog rows separate from active official session state.

## 2. Build The Generation-Scoped Provider

- Create one provider/subscription owner per active runtime generation.
- Hydrate the authoritative snapshot batch and reject stale results.
- Add narrow selectors/contexts for transcript, runtime controls, commands,
  session metadata, extension UI, and stats.
- Replace `src/store/models.tsx` production fixtures and credential-derived
  filtering with official `get_available_models`/`get_state.model` state. An
  unavailable local Pi produces an empty setup state, never mock models; absent
  preload is handled before providers mount.
- Sequence model-list, selection, state, and thinking-level requests by current
  generation/session so late responses cannot overwrite a newer scope.

## 3. Render Official Messages And Events

- Replace the legacy message reducer with documented snapshot and delta-event
  projection.
- Adapt existing message/tool/progress components to official variants and IDs.
- Add snapshot recovery on reconnect, session changes, sequence uncertainty,
  and `agent_settled` where required.

## 4. Wire Every Supported Action

- Implement prompt/steer/follow-up/abort; new/open; model/thinking/modes;
  compact/automatic-retry controls; rename/fork/clone; entries/tree inspection;
  bash; commands; stats; and optional export.
- Refresh state/catalog after session-mutating commands.
- Add controlled process restart for externally changed Pi packages/extensions
  and refresh commands/state/catalog afterward.

## 5. Build Running Queue And Steer UX

- Keep Composer editable while streaming and replace its stop-only branch with a
  stable Stop button plus split submit control: primary `follow_up`, explicit
  one-shot `steer`, idle `prompt`.
- Route text/images/formatted context through one captured-submission path; block
  duplicate acceptance requests, clear only matching captured state on success,
  and retain it on every official failure without fallback.
- Project `pendingMessageCount` plus current-generation `queue_update` into a
  bounded read-only Steer/Queue popover. Clear details on replacement and never
  persist or infer missing entries.
- Add official one-at-a-time/all segmented controls through
  `set_steering_mode`/`set_follow_up_mode`, then refresh `get_state`; add no item
  cancel/edit/reorder.
- Use `get_commands.source` to route extension commands to a labeled immediate
  `prompt` action while prompt templates/skills retain Queue/Steer.

## 6. Build The Bounded Real Model Picker

- Replace Composer's unbounded model `DropdownMenu` with existing Popover/Command
  primitives and the specified viewport width/height caps.
- Keep search/header fixed and results independently scrollable; group by
  provider, use one-column rows, truncate long values with tooltips, and preserve
  keyboard navigation/focus.
- Bind rows directly to full official Model identities. Send one
  `set_model(provider, modelId)` per selection, refresh state/thinking levels on
  success, and retain the previous model plus official error on failure.
- Remove model credential editing from Settings. Keep only real local-Pi model
  status/refresh/setup guidance and explicit loading/empty/disconnected states.
- Drive Models Settings from the same official selectors/actions as Composer;
  delete its hard-coded thinking array, configured/invalid-model filtering,
  credential forms/tests, and duplicate local state.

## 7. Implement Extension UI

- Add correlated select/confirm/input/editor dialogs and cancellation.
- Add notify, keyed status/widget, title, and composer-text surfaces.
- Handle extension errors and documented TUI-only degradation without private
  commands or component emulation.

## 8. Remove Unsupported Renderer Semantics

- Delete production use of the legacy message store/reducer and semantic Agent
  preload API.
- Remove session delete/pin, credential/resource CRUD, approvals/model safety,
  MCP risk review, stale routes/shortcuts/model mocks/locales, and no-op
  placeholders. Structurally remove `WEB_MODELS`, `WEB_SELECTED`,
  `WEB_CREDENTIALS`, production mock-data imports, and model credential gates.
- Remove any renderer model branch keyed to a standalone web mode. Keep only the
  Electron preload-backed path and test fixtures outside production source.
- Preserve all unrelated desktop features and official RPC-supported actions.

## 9. Verify The Cutover

After all renderer edits:

```bash
pnpm test:unit -- tests/unit/local-pi-rpc-renderer.test.ts tests/unit/local-pi-extension-ui.test.ts
pnpm typecheck
pnpm test:electron -- --grep "local Pi RPC workflow"
pnpm build
```

Exercise a deterministic global/project extension fixture across restart and
record actual results, including the official TUI-only degraded case. Capture
normal/narrow Electron model-picker visuals with a long real configured-model
list and verify that only the results region scrolls. Exercise running primary
Queue, explicit Steer, independent Stop, queue popover/modes, reconnect count-only
state, command-source routing, and draft/attachment retention on rejection.

## File Ownership And Pre-Start Gate

This child owns renderer Agent provider/state/hooks/components, supported action
and extension UI wiring, Agent-specific locales/fixtures/tests, and legacy
renderer semantic removal. Main host and session catalog contracts must be
stable first. Backend dead-code and obsolete persistence-code deletion remain a
later child; no runtime old-data cleanup is added. Context manifests must
validate before start.
