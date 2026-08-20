# Remove The Legacy PiPilot Agent Stack

## Goal

After local-Pi runtime and renderer cutover, delete every superseded PiPilot
Agent implementation and policy so production has one official Agent runtime,
while retaining PiPilot's independent Electron desktop workspace features and no
standalone web/mock product mode.

## Confirmed Boundary

- Official local Pi owns Agent behavior, tools, models, sessions, compaction,
  retries, packages/extensions/skills/prompts, and optional MCP execution.
- PiPilot retains only integration glue that is necessary to launch documented
  RPC, present official state, list current Pi session metadata read-only, and
  provide desktop workspace/file/terminal/Diff/UI features.
- Delete custom approvals, permission/safety policy, credential ownership,
  resource/MCP risk scanning, sensitive-environment/path policy, and mutation
  fingerprints tied to removed operations.
- Retain baseline correctness only: process-generation/request correlation,
  canonical in-workspace path resolution, atomic surviving settings/workspace
  persistence, and bounded current-format session catalog reads.
- Session rename/fork/clone, entries/tree inspection, compaction,
  automatic-retry controls, follow-up/modes, commands, stats, official bash, and
  supported extension UI remain because official RPC provides them.
- React/Vite is only the Electron renderer. Test fixtures may simulate Pi under
  tests, but production cannot import static conversations/models/workspaces/
  resources or select a browser Store/adapter branch.

## Requirements

- Delete the old `src/agent-worker` entry and its orchestration, model-safety,
  permission gate, resource catalog/risk scan, transcript projection, and Pi SDK
  construction after local RPC is the production path.
- Delete the legacy Main Agent supervisor semantics, custom Agent request/event
  protocol, renderer message reducer/store semantics, and obsolete Agent
  IPC/preload handlers.
- Delete permission policy/repository/service, approval schemas/cards/state,
  credential remnants not already removed, resource repository/catalog/risk
  UI, model rollback/caps/filtering, and feature-specific tests/locales/docs.
- Delete every source path, repository, schema, startup hook, and product claim
  for PiPilot `permissions.json` and `resource-preferences.json`. Do not add old
  external-data inspection, deletion, import, or compatibility code.
- Remove Agent-specific environment scrubbing so the selected local Pi inherits
  the normal host environment, including provider and Pi configuration values.
- Remove workspace sensitive-file hiding and Agent-policy fingerprints. Remove
  Diff accept/revert services and mutation-conflict fingerprints with the
  read-only Diff sibling, while keeping canonical workspace containment and
  bounded read operations.
- Remove old Worker build inputs, preload mocks, unsupported action call sites,
  active product claims, and direct `@earendil-works/pi-ai` /
  `@earendil-works/pi-coding-agent` dependencies after all imports are gone.
- Delete standalone `dev:web`/`build:web`, the browser-server visual harness,
  production `src/data/mock` and imports, `'web'` Store/adapter modes, static
  App/Inspector/workspace/resource/model branches, `LocalStorageSettingsAdapter`,
  and browser-preview/visual-test product environment flags.
- Require preload before application providers mount. A missing bridge may render
  only a minimal unsupported-environment state; it cannot initialize a reduced
  application or mutate localStorage as Settings authority.
- Rebuild Settings navigation after sibling handoffs to contain only General,
  Appearance, Language, Models, Terminal, MCP, and About. Remove Permissions,
  Agent Resources, Updates, disabled General controls, hard-coded Pi SDK/About
  fallbacks, credential forms, and corresponding stale locales/tests.
- Confirm retained Settings values come from their real owners: Main executable/
  app info, Main AppSettings, official model/thinking RPC, terminal state, and
  standard MCP files plus official command detection. Defaults/caches are valid
  only as current-schema desktop settings, never sample product data.
- Preserve LocalPiRuntimeHost/JSONL contracts, renderer RPC adapter, official
  session catalog, optional MCP standard-config adapter, app settings,
  workspace/file tree/context, terminal, read-only Diff, navigation, appearance,
  icon/brand, localization framework, and Electron loading/lifecycle plumbing.
- Do not stage or commit machine-local `.agents/skills/` symlink/deletion noise.

## Acceptance Criteria

- [ ] Production contains one Agent execution path: the selected local
      `pi --mode rpc --approve` process; no embedded Worker/runtime fallback is
      reachable.
- [ ] No production import/reference remains for the custom Agent protocol,
      semantic supervisor, Worker transcript/resource/permission/model policies,
      or legacy renderer transcript reducer/store.
- [ ] No production credential, approval/permission, model-safety, resource-risk,
      MCP-risk, sensitive-environment, or sensitive-workspace-path policy remains.
- [ ] No product path/repository/schema remains for `permissions.json` or
      `resource-preferences.json`, and there is no startup cleanup/import branch
      for old external app data.
- [ ] Rename, fork/clone, entries/tree inspection, compact, automatic-retry
      controls, follow-up/modes, commands, stats, official bash, and supported
      extension UI still work through official RPC after deletion.
- [ ] Session delete/pin, credential/resource CRUD, approvals, MCP risk review,
      Diff accept/revert, and their backend/IPC/UI contracts are absent.
- [ ] Canonical workspace containment, bounded reads, atomic surviving app state,
      RPC generation/request correlation, and current Pi session catalog remain.
- [ ] PiPilot desktop workspace, file tree/context, terminal, read-only Diff,
      appearance, settings, navigation, icons, and brand remain buildable.
- [ ] Direct Pi runtime SDK dependencies and the old Worker build entry are
      absent from manifests/lockfile/output after pnpm cleanup.
- [ ] `dev:web`, `build:web`, browser webServer visual configuration,
      production `src/data/mock` imports, `'web'` Store/adapter modes,
      `LocalStorageSettingsAdapter`, and static product fixtures are absent.
- [ ] Missing preload cannot mount providers, and visual regression tests launch
      Electron with test-only fixtures through the real preload/Main path.
- [ ] Settings has no Permissions/Agent Resources/Updates/credential or disabled
      placeholder surfaces; General/Models/Terminal/MCP/About values and states
      are traceable to their real owners and no hard-coded Pi SDK version remains.
- [ ] Obsolete behavior-only tests are removed; broad tests are updated to the
      official path without weakening unrelated assertions.
- [ ] Structural checks, focused tests, typecheck, and build pass.

## Out Of Scope

- Refactoring retained desktop features beyond integration fixes owned by this
  deletion.
- Deleting app protocol/window/navigation code required for Electron to load or
  route the desktop app.
- Removing Electron Chromium `sessionData`, Playwright's Electron/CDP connection,
  or a non-authoritative pre-paint cache solely because their implementation uses
  browser technologies; none is standalone web support.
- Reimplementing an official Pi capability with custom Agent semantics.
- Restoring session delete/pin, approval policy, credential/resource management,
  MCP risk scanning, Diff mutation, or sensitive-file filtering.
- Bulk-deleting historical completed-task evidence solely because it describes
  the old architecture.

## Dependencies And Ownership

This child follows runtime host, session catalog, renderer cutover, credential
removal, read-only Diff, terminal Settings, and MCP Settings. The cross-parent
terminal/MCP handoffs must land before its final SettingsLayout cleanup. It owns
dead backend/shared/preload/renderer Agent modules,
permission/resource persistence removal, feature-policy/integrity removal, stale
build/config/dependencies, web/mock mode removal, final Settings layout cleanup,
obsolete tests/locales/active docs, and final residual callers. Runtime,
renderer, terminal, and MCP sibling owners remain authoritative for the real data
feeding retained Settings surfaces.

## Risks And Deferred Items

- Broad filenames such as `security` or `workspace` contain both removable
  policy and required desktop plumbing. Delete by live symbol/caller inventory,
  not directory name.
- Local Pi now receives normal environment values by design. PiPilot does not
  inspect, redact, approve, or rank tool/plugin/MCP behavior.
- Historical docs can remain as evidence, but current README/package copy must
  not promise deleted security/policy behavior.
