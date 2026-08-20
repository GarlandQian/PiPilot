# Implementation Plan

## 1. Split Host And IPC Tree DTOs

- Add strict flat tree row/result schemas without weakening the official host
  response schema.
- Add one iterative Main projector and cloneability probe.
- Return the projected response only from the trusted local-Pi command handler.
- Update preload/API/provider/Agent inspector types and remove redundant nested
  flattening.

Likely files:

- `src/shared/local-pi.ts`
- `src/shared/ipc/contracts.ts`
- `src/main/ipc/register-local-pi-ipc.ts`
- `src/store/pi-rpc.tsx`
- `src/components/inspector/AgentContextPanel.tsx`

## 2. Complete Catalog Convergence

- Refactor active refresh state into a dirty-generation coordinator.
- Preserve same-scope coalescing, scoped cache invalidation, and identity-safe
  cleanup.
- Queue one continuation when normal churn exceeds the foreground budget.
- Keep real action errors distinct from refresh churn.
- Verify renderer request epochs suppress only superseded background refreshes.

Likely files:

- `src/main/conversations/official-pi-session-catalog.ts`
- `src/store/workspace.tsx`
- `tests/unit/official-pi-session-catalog.test.ts`

## 3. Gate Inspector Content

- Mount Files/Changes/Pi Session controllers only for a fully ready
  conversation.
- Clear request/controller state on readiness identity changes.
- Add shared centered empty/loading/error content without gating Terminal.
- Ensure tab selection cannot trigger a stale fetch while not ready.

Likely files:

- `src/components/inspector/InspectorPanel.tsx`
- `src/components/inspector/AgentContextPanel.tsx`
- `src/components/inspector/continuous-diff-controller.ts`
- locale catalogs

## 4. Focused Verification

Run after all edits:

```bash
pnpm exec vitest run \
  tests/unit/local-pi-runtime-host.test.ts \
  tests/unit/ipc-contracts.test.ts \
  tests/unit/official-pi-session-catalog.test.ts \
  tests/unit/local-pi-rpc-renderer.test.ts \
  tests/unit/agent-context-panel.test.ts
pnpm typecheck
pnpm build
pnpm exec playwright test --config=playwright.electron.config.ts \
  --grep "deep tree|session catalog|session loading"
git diff --check
```

## Ownership And Handoff

This child owns local-Pi tree IPC projection, catalog refresh coordination, and
inspector readiness gates. It does not edit package management, MCP, Composer
candidate surfaces, or adapter code. Re-read shared IPC/provider/Electron files
before editing and report exact contract changes to sibling tasks.

## Pre-Start Gate

- Parent artifacts and this child's PRD/design/plan are reviewed.
- Both context manifests contain real entries and validate.
- The parent final plan has explicit user approval before this child starts.
