# Implementation Plan

## 1. Exact Pi Management Helper

- Add package-root discovery from the canonical executable with exact manifest
  name/version/export validation.
- Define bounded helper command/event/result schemas.
- Add a short-lived Electron Node-mode helper that imports the matching Pi
  public API and supports snapshot, install, update, remove, update-check, and
  public retry-settings operations.
- Add deadlines, stderr bounds, forced shutdown, mutation serialization, and
  helper generation cleanup.

## 2. Main, IPC, And Store

- Add `LocalPiIntegrationService` for scope resolution, helper composition,
  runtime observations, progress, restart marker, and refresh.
- Define strict shared IPC/preload/API contracts with opaque operation IDs and
  bounded DTOs.
- Add renderer store states for unavailable/checking/loading/ready/operating/
  restart-required/error and reject stale executable/scope results.
- Keep resource effective state read-only and expose the Pi-config diagnostic.

## 3. Integrations Settings

- Replace the standalone MCP nav item with Integrations without changing other
  settings sections.
- Build responsive Overview, Packages, MCP, and Resources list/detail
  composition.
- Implement Add Package, Update, Remove confirmation, inline progress/error,
  scope switch, search/filter, compatibility labels, and controlled restart.
- Show Extensions/Skills/Prompts/Themes metadata and effective state without
  single-resource toggles.

## 4. MCP List/Form/Raw Draft

- Refactor current `McpSettings` into server list, selected detail, Add/Edit
  STDIO/HTTP forms, and Advanced Raw JSON.
- Preserve the existing adapter/service/parser, exact scope paths, dirty state,
  fingerprint conflict, comments, unknown fields, Save, and Save + Restart.
- Route unsupported structured shapes to Raw without destructive normalization.

Likely files:

- new `src/main/local-pi-management/*`
- new `src/shared/pi-integrations.ts`
- shared IPC/API and preload
- `src/main/index.ts`
- new renderer integrations adapter/store/components
- `src/components/settings/SettingsLayout.tsx`
- `src/components/settings/McpSettings.tsx` or split replacements
- locale catalogs

## 5. Verification

Use fixtures for the external Pi module/helper and never mutate the developer's
real package settings in tests.

```bash
pnpm exec vitest run \
  tests/unit/local-pi-package-locator.test.ts \
  tests/unit/local-pi-management-host.test.ts \
  tests/unit/pi-integrations-service.test.ts \
  tests/unit/ipc-contracts.test.ts \
  tests/unit/mcp-config-parser.test.ts \
  tests/unit/mcp-config-service.test.ts \
  tests/unit/i18n.test.ts
pnpm typecheck
pnpm build
pnpm exec playwright test --config=playwright.electron.config.ts \
  --grep "Integrations|MCP settings"
git diff --check
```

The Electron fixture must prove exact module-version binding, global/project
scope, one package mutation with progress and pending restart, unavailable
management without chat failure, structured/raw MCP round-trip, and responsive
list/detail navigation.

## Ownership And Handoff

This child owns package-management helper/Main/shared/preload/store/Settings and
MCP UI files. It must publish the final package snapshot and retry-settings API
to the Plan/Retry child. It does not edit Composer/activity or implement rich
plugin adapters. Preserve existing MCP JSONC behavior and unrelated worktree
changes.

## Pre-Start Gate

- Parent artifacts and this child's PRD/design/plan are reviewed.
- Both context manifests contain real entries and validate.
- The parent final plan has explicit user approval before this child starts.
