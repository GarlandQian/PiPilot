# Implementation Plan

## 1. Add Official Response Provenance

- Extend the projector snapshot with a generation/session-scoped official entry
  snapshot and reset it with every runtime/session replacement.
- Hydrate full `get_entries` with the initial message snapshot; use the stable
  entry cursor for incremental settled refreshes and retry one full request when
  Pi rejects a cursor.
- Add a pure iterative active-path/context-origin helper that mirrors the
  supported Pi 0.84.1 compaction selection and verifies alignment with
  `get_messages` without comparing text.
- Group flat rendered turns by preceding visible user entry and append one
  derived response-action turn after all response content.

Primary files:

- `src/store/pi-rpc.tsx`
- `src/renderer/pi-rpc/projector.ts`
- `src/renderer/pi-rpc/presentation.ts`
- `src/renderer/pi-rpc/response-provenance.ts` (new if the helper is not small)
- `src/types/chat.ts`

## 2. Render Copy And Direct Fork

- Render stable Copy and Fork Tabler icon buttons for response-action turns in
  `MessageList`; add tooltips, accessible names, copy-success feedback, inline
  error announcement, and one global Fork-in-flight guard.
- Wire Fork directly to the existing official `fork { entryId }` provider
  action. Preserve returned-text Composer draft behavior and full hydration
  gating.
- Remove the sidebar `onFork` API, Fork menu item/imports, App fork-message
  state, `get_fork_messages` picker request, and global Fork dialog.
- Keep sidebar Duplicate mapped to official `clone`.

Primary files:

- `src/components/chat/MessageList.tsx`
- `src/components/layout/SessionList.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/App.tsx`
- `src/i18n/locales/en-US.json`
- `src/i18n/locales/zh-CN.json`

## 3. Add Main-Owned Session Deletion

- Define strict delete request/result schemas and IPC channel; expose them only
  through `PiPilotApi.sessionCatalog.delete` and validated preload invoke.
- Refactor catalog selection verification so delete consumes its opaque token
  once and returns a Main-only canonical target with stable identity. Preserve
  ordinary open and one-shot moved-recovery behavior.
- Add an injected `OfficialPiSessionDeletionService` for active canonical match,
  bounded activation stop, post-stop revalidation, Electron `shell.trashItem`,
  unlink fallback, typed errors, and scoped invalidation.
- Serialize delete through `ConversationContextService`; compose the service and
  production trash dependency in Main; map typed errors in catalog IPC.

Primary files:

- `src/shared/conversation-scope.ts`
- `src/shared/ipc/contracts.ts`
- `src/shared/pipilot-api.ts`
- `src/preload/index.ts`
- `src/main/conversations/official-pi-session-catalog.ts`
- `src/main/conversations/official-pi-session-deletion-service.ts` (new)
- `src/main/conversations/conversation-context-service.ts`
- `src/main/ipc/register-session-catalog-ipc.ts`
- `src/main/index.ts`

## 4. Connect Delete UI And Store State

- Add `deleteSession(scope, selectionToken)` to the renderer adapter/store.
- Track the exact deleting selection token so only one row shows loading and
  duplicate Delete attempts are disabled.
- Add the controlled destructive confirmation dialog in App, including active-
  run and permanent-fallback wording. Keep it open with an inline typed error on
  failure and close it only after success/cancel.
- On success refresh only the owning catalog. Clear active session identity when
  Main reports `activeDeleted`, preserving its scope/project. Also clear session
  identity for authoritative stopped/error/crashed runtime snapshots.
- Replace the sidebar Fork item with Delete; keep Rename and Duplicate.

Primary files:

- `src/renderer/adapters/workspace-adapter.ts`
- `src/store/workspace.tsx`
- `src/components/layout/SessionList.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/App.tsx`
- both locale files

## 5. Synchronize Contracts And Focused Regressions

- Update official session catalog and official renderer specs to replace the
  read-only/no-delete statement and picker-based Fork sequence with the approved
  explicit exceptions and invariants.
- Add renderer projection regressions for duplicate prompts, abandoned branches,
  compaction, deep paths, tool loops, incomplete responses, alignment failure,
  exact copy payload, and exact Fork ID.
- Add catalog/deletion/context tests for one-shot tokens, cross-scope/stale
  rejection, active versus inactive behavior, canonical identity races, trash
  success, unlink fallback, double failure, and no renderer path.
- Extend the existing fake Pi/Electron workflow for direct footer Fork, removal
  of the old picker/menu item, confirmation/loading, and active-view clearing.
  Stub destructive Main behavior in unit tests; do not move Electron fixtures to
  the developer's actual Trash.

Likely tests:

- `tests/unit/local-pi-rpc-renderer.test.ts`
- `tests/unit/ipc-contracts.test.ts`
- `tests/unit/official-pi-session-catalog.test.ts`
- `tests/unit/official-pi-session-deletion-service.test.ts` (new)
- `tests/unit/conversation-context-service.test.ts`
- `tests/electron/pipilot.electron.spec.ts`
- `tests/fixtures/fake-pi.mjs`

## Implementation Ownership

After explicit approval/start:

- Renderer provenance worker owns projector/presentation/provider helper and its
  focused pure tests.
- Main deletion worker owns catalog deletion resolution, deletion service,
  context/IPC composition, and its focused tests.
- Integration worker/root owns shared contract coordination, App/sidebar/store,
  locales, Electron fixture/spec, conflict resolution, and final verification.

Workers are not alone in the worktree. They must preserve existing user changes,
avoid `.agents` symlink noise, and re-read shared files immediately before edits.
The Main worker's contract shape is a dependency of the integration work; the
renderer provenance helper is a dependency of MessageList action wiring.

## Verification

Finish all related edits before checking. Start with focused shared/core tests:

```bash
pnpm exec vitest run \
  tests/unit/local-pi-rpc-renderer.test.ts \
  tests/unit/ipc-contracts.test.ts \
  tests/unit/official-pi-session-catalog.test.ts \
  tests/unit/official-pi-session-deletion-service.test.ts \
  tests/unit/conversation-context-service.test.ts
pnpm typecheck
```

Then run cross-layer and desktop evidence because this touches the shared
projector, Main lifecycle, IPC/preload, filesystem mutation, and core UI:

```bash
pnpm test:unit
pnpm exec playwright test --config=playwright.electron.config.ts \
  --grep "local Pi RPC workflow"
pnpm build
pnpm package:dir
git diff --check
```

For Electron GUI commands, request the existing required sandbox escalation.
Packaging must load the `electron-builder` skill before execution, as requested
by the user. Do not claim release signing/notarization or cross-platform package
results unless those exact steps are run.

## Completion Conditions

- No production sidebar/global-dialog references to `get_fork_messages` remain.
- The generic official command remains supported for compatibility with Pi, but
  this UI uses stable response provenance and direct `fork`.
- No delete contract accepts or returns a path.
- No stale transcript/model/queue data is visible during Fork or after active
  deletion.
- Session deletion cannot affect another scope, a changed file, or an inactive
  runtime that merely shares a session ID.
- All changed specs describe the implemented official/self-owned boundary.
