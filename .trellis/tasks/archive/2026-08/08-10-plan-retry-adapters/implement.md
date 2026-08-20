# Implementation Plan

## 1. Adapter Registry And Contracts

- Define exact adapter IDs, capability results, bounded Plan/Retry DTOs, and
  version predicates.
- Join package facts with official command/source metadata without exposing
  private paths to renderer adapter logic.
- Reset registry/projector state on scope/session/generation replacement.
- Register only Plan Mode and Retry.

## 2. Plan Mode Adapter

- Add strict schemas for supported completion details, custom messages, and
  exact status values.
- Project inline Markdown and active planning/ready/saved/implementing state.
- Map only verified direct `/plan` routes and existing extension dialog paths;
  route all commands through current official provider actions/hydration.
- Keep unsupported data in generic tool/message/activity rendering.

## 3. Retry Settings And Runtime Sync

- Consume the Integrations helper's matching `getRetrySettings` and
  `setRetryEnabled`/`flush` operations.
- Replace header Enable+Disable actions with one authoritative global setting
  surface; show the selected scope's merged effective value separately and do
  not label the public setter as project-scoped.
- Synchronize a ready process via official `set_auto_retry` and represent
  persisted-only/partial failures.
- Keep maxRetries/baseDelayMs read-only.

## 4. Retry Activity UI

- Expose full official retry projector state rather than only `retryActive` and
  an unused message.
- Render provider retry activity above the Composer with attempt/max,
  display-only countdown, bounded reason, Stop, recovered, and final failure.
- Keep summarization retry distinct.
- Add exact pi-retry status enrichment and generic fallback.

Likely files:

- new `src/renderer/pi-rpc/adapters/*`
- `src/renderer/pi-rpc/projector.ts`
- `src/store/pi-rpc.tsx`
- Integrations settings adapter/store contracts
- generic activity host components
- `src/components/chat/ChatHeader.tsx`
- `src/App.tsx`
- locale catalogs

## 5. Verification

Use fixture packages/events; do not edit the developer's real Pi settings.

```bash
pnpm exec vitest run \
  tests/unit/local-pi-rpc-renderer.test.ts \
  tests/unit/pi-adapter-registry.test.ts \
  tests/unit/plan-mode-adapter.test.ts \
  tests/unit/retry-adapter.test.ts \
  tests/unit/pi-integrations-service.test.ts \
  tests/unit/i18n.test.ts
pnpm typecheck
pnpm build
pnpm exec playwright test --config=playwright.electron.config.ts \
  --grep "Plan Mode|retry"
git diff --check
```

Tests cover supported/unsupported versions, malformed details, generic
fallback, session/generation replacement, Plan action hydration, retry setting
success/partial/failure, countdown display, abort, recovery/final failure,
summarization separation, and absence of pi-retry.

## Ownership And Handoff

This child consumes but does not redesign the Integrations helper or generic
activity host. It owns adapter schemas/projectors/actions and Retry settings UI
composition. Re-read provider/App/locales immediately before editing and
preserve sibling changes. Do not add another plugin adapter opportunistically.

## Pre-Start Gate

- Both dependency child contracts are complete and handed off.
- Parent artifacts and this child's PRD/design/plan are reviewed.
- Both context manifests contain real entries and validate.
- The parent final plan has explicit user approval before this child starts.
