# Phase 2 Report - Settings Persistence

Date: 2026-08-07

> **Historical snapshot (2026-08-07):** This report preserves the evidence and
> assumptions of Phase 2. It is not current product or release authority. See
> [the documentation index](README.md), [Architecture](ARCHITECTURE.md),
> [Packaging](PACKAGING.md), and [Test Matrix](TEST_MATRIX.md).

## 1. Phase name

Phase 2 - Main-owned settings persistence.

## 2. Completed work

- Preserved the existing `ThemeMode`, `Locale`, `Density`,
  `AppearanceSettings`, `AppSettings`, defaults, UI hooks, and component
  interaction surface.
- Moved settings domain types/defaults, deep merge, sanitization, and migration
  logic into shared code without coupling the renderer to Electron.
- Added strict Zod schemas in a separate Main/preload-only module so renderer
  bundles do not carry the IPC validation library.
- Added a version-1 Main `SettingsRepository` under `userData/settings.json`.
- Added first-run import of the existing sanitized renderer cache, current and
  version-zero document migration, deep default filling, unknown-field removal,
  and rejection of unknown future versions.
- Added atomic mode-0600 writes, 150 ms write debounce, synchronous final flush,
  in-memory immediate state, and monotonically increasing runtime revisions.
- Guarded the final quit-time flush so a storage failure is diagnosed without
  preventing Electron from shutting down.
- Added corrupt/unrecognized file backup before restoring defaults. Diagnostics
  expose only fixed codes and never the file contents, path, or suspected
  secrets.
- Added typed and runtime-validated get/update/reset IPC plus a validated
  Main-to-preload settings-changed event.
- Added `window.pipilot.settings` with only `get`, `update`, `reset`, and
  `subscribe`; raw channels remain hidden.
- Added explicit `LocalStorageSettingsAdapter` for web/visual mock mode and
  `ElectronSettingsAdapter` for desktop mode.
- Kept a sanitized localStorage mirror only as an untrusted pre-paint cache.
  Main is authoritative after the first successful Electron call.
- Reworked the renderer settings store for immediate optimistic UI, ordered
  revision reconciliation, failure reload/rollback, and external event updates.
- Preserved pre-paint theme behavior and immediate theme/font/density/locale
  application.
- Updated the existing General settings storage note in both locales so it
  truthfully distinguishes Electron Main persistence from browser preview
  localStorage.

## 3. Modified files

- `src/shared/settings.ts`
- `src/shared/schemas/settings.ts`
- `src/shared/ipc/contracts.ts`
- `src/shared/pipilot-api.ts`
- `src/main/repositories/settings-repository.ts`
- `src/main/ipc/register-app-ipc.ts`
- `src/main/index.ts`
- `src/preload/index.ts`
- `src/renderer/adapters/settings-adapter.ts`
- `src/store/settings.tsx`
- `src/types/settings.ts`
- `src/i18n/locales/en-US.json`
- `src/i18n/locales/zh-CN.json`
- `vitest.config.ts`
- `tests/unit/settings.test.ts`
- `tests/unit/ipc-contracts.test.ts`
- `tests/electron/pipilot.electron.spec.ts`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/PHASE_2_REPORT.md`

## 4. Purpose of each modified file

| File/group | Purpose |
| --- | --- |
| `src/shared/settings.ts` | Framework-free settings types, defaults, sanitize/deep-merge, and document migration |
| `src/shared/schemas/settings.ts` | Strict runtime schemas used by privileged process boundaries |
| `src/shared/ipc/contracts.ts` | Settings invoke/event channels, payloads, snapshots, reset scope, and result schemas |
| `src/shared/pipilot-api.ts` | Typed settings facade exposed to renderer code |
| `settings-repository.ts` | Main authority, migration, corruption backup, atomic/debounced persistence, revisions, and listeners |
| Main IPC/index | Repository lifecycle, validated handlers, event publication, and quit flush |
| preload | Validated facade calls and safe event subscription wrapper |
| renderer settings adapter | Explicit Electron versus web persistence implementations and pre-paint cache |
| renderer settings store | Immediate optimistic state plus authoritative revision reconciliation |
| `src/types/settings.ts` | Preserve existing renderer import path while re-exporting shared domain types/defaults |
| locale files | Accurate bilingual persistence note; no layout/style change |
| Vitest config/tests | Alias support and settings migration/repository/adapter/store/IPC regressions |
| Electron test | Real event, UI application, file persistence, cache mirror, and restart evidence |
| docs | Current ownership, phase progress, evidence, limitations, and next work |

## 5. Dependencies added and reason

None.

The existing Zod 4.4.3 dependency is reused for privileged runtime schemas,
Vitest 4.1.10 for unit tests, and Playwright 1.62.1 for the existing Electron
and frozen visual runners. The schema module was deliberately separated from
the renderer domain module so this reuse does not inflate the browser UI
bundle.

## 6. New IPC

| Channel/event | Facade | Payload/result |
| --- | --- | --- |
| `pipilot:settings:get` | `settings.get(legacySettings?)` | Optional sanitized first-run cache -> revisioned complete settings snapshot |
| `pipilot:settings:update` | `settings.update(patch)` | Strict deep partial patch -> immediate revisioned snapshot |
| `pipilot:settings:reset` | `settings.reset(scope)` | `all` or `appearance` -> revisioned snapshot |
| `pipilot:settings:changed` | `settings.subscribe(listener)` | UUID event plus validated revisioned snapshot; raw Electron event is removed |

All invoke requests retain Phase 1 UUID correlation, exact trusted main-frame
authorization, request/response/result validation, and structured errors. The
event is built and validated in Main, validated again in preload, and delivered
only as a business snapshot.

## 7. New shared types

- `AppSettingsPatch`
- `PersistedSettingsDocument`
- `SettingsMigrationResult`
- `SettingsSnapshot`
- `SettingsChangedEvent`
- `SettingsResetScope`
- `SettingsAdapter`
- `SettingsRepositorySnapshot`
- `SettingsDiagnosticCode`

The existing settings types retain their old renderer import path through
re-exports, so component APIs did not change.

## 8. New runtime schemas

- theme, locale, and density enums;
- strict appearance and complete app-settings schemas;
- strict deep-partial appearance/app update schemas;
- strict version-1 persisted document schema;
- revisioned settings snapshot schema;
- UUID settings-changed event schema;
- reset-scope schema;
- get/update/reset request and result schemas.

The migration layer accepts only current version 1, known version 0, or a
recognizable unversioned legacy settings shape. Unknown future versions are
backed up and recovered instead of being guessed.

## 9. Tests added

Phase 2 added 11 unit assertions, bringing the suite to 4 files and 27 tests.

- version-zero partial migration, clamping, deep defaults, and unknown-field
  removal;
- unknown future-version rejection;
- first-run legacy cache import;
- debounced write not reaching disk until flush;
- version-zero on-disk rewrite;
- corrupt content backup with deterministic name and redacted diagnostic;
- appearance-only reset preserving locale;
- deterministic web adapter cache behavior;
- Electron adapter treating localStorage as cache rather than authority;
- immediate optimistic renderer update and confirmed snapshot reconciliation;
- strict update and changed-event IPC schemas.

The existing Electron test now also proves:

- the frozen bridge exposes the added `settings` business namespace;
- update emits a subscribed, validated snapshot;
- renderer language/theme apply immediately;
- the pre-paint cache mirrors the authoritative snapshot;
- `settings.json` is versioned and survives app restart;
- restarted renderer applies the persisted dark theme before/while loading.

## 10. Verification commands

- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm build`
- `pnpm test:electron`
- `pnpm test:visual`
- `pnpm peers check`
- focused `git diff --check`, trailing-whitespace, ignore, security-pattern, and
  symlink-index checks

## 11. Real result of each command

### TypeScript and unit tests

- First TypeScript run found use of `Object.hasOwn`, which is outside the
  project's ES2020 library target. It was replaced with an own-property helper.
- Final `pnpm typecheck`: passed without diagnostics.
- Final `pnpm test:unit`: 4 files passed, 27 tests passed, 269 ms.

### Build

- The first successful Phase 2 build showed 719 renderer modules and 2.045 MB
  JS because the shared settings file imported Zod.
- Settings domain/migration code and privileged Zod schemas were separated.
- Final `pnpm build`: passed.
  - Main: 15 modules, 32.98 kB.
  - Preload: 83 modules, 145.25 kB.
  - Renderer: 640 modules, HTML 1.56 kB, CSS 94.79 kB, JS 1,907.73 kB before
    release minification.

### Electron integration

- The first managed-sandbox attempt was blocked before Electron startup with
  `SIGABRT`/`EPERM`; the same command was rerun in the approved desktop
  environment.
- Final `pnpm test:electron`: 1 passed, 0 failed, 3.6 seconds.
- The test exercised settings update/subscription, immediate DOM theme/locale,
  cache mirror, real `userData/settings.json`, app close, app restart, and
  restored settings together with the Phase 1 security/window checks.

### Visual regression

- The first managed-sandbox attempt could not bind the local Vite loopback port
  (`listen EPERM`); the same command was rerun in the approved desktop
  environment.
- Final `pnpm test:visual`: 8 passed, 0 failed, 11.6 seconds.
- Baseline updates remained disabled. The settings store/adapter migration
  produced zero changed pixels in dark/light idle, running, waiting approval,
  and Appearance settings references.

### Repository checks

- Final peer check reports no dependency issues.
- Text/whitespace checks pass.
- Build/test/cache artifacts and local skill symlinks remain ignored.
- Git index still contains no symlink entry.

## 12. UI files modified

- `src/store/settings.tsx` (state implementation only)
- `src/types/settings.ts` (shared re-export only)
- `src/i18n/locales/en-US.json`
- `src/i18n/locales/zh-CN.json`

No component markup, layout, classes, tokens, typography, controls, setting
order, or interaction design changed.

## 13. UI modification necessity

The store implementation had to change to select a web or Electron adapter and
reconcile asynchronous Main snapshots while keeping existing hook calls
synchronous and visually immediate. The only visible copy change replaces the
now-false “Electron will be integrated later” note with an accurate bilingual
description of Main persistence and browser preview localStorage.

This is a factual status correction required by the feature, not a redesign.

## 14. Visual regression result

Passed: 8 of 8 reviewed macOS references with no baseline update and no pixel
differences in the frozen scenarios.

## 15. Mock data still in use

- General notification/sound/usage switches are still visual-only controls;
- workspace and recent projects;
- sessions and actions;
- models/providers/context usage;
- messages, streaming, tools, and approval state;
- files, diffs, terminal, and logs;
- update/about runtime information.

Locale and appearance settings are now real in Electron mode. Web mode remains
an explicit localStorage-backed mock adapter for development and visual tests.
Pi SDK remains absent.

## 16. Known issues

- The current authoritative settings schema intentionally contains only locale
  and appearance because those are the approved functional settings in scope.
  General and later model/agent/permission/terminal/update controls remain for
  their ordered phases.
- Deferred write failures keep the in-memory UI responsive and emit a redacted
  Main diagnostic, but there is not yet a user-visible persistence warning.
- The localStorage mirror is required for pre-paint theme and first-run import;
  it contains non-secret appearance/locale only and is never authoritative once
  Main initializes.
- Unknown/corrupt files are recoverably backed up; there is not yet a UI for
  inspecting or restoring those backups.
- Remote approved fonts, unminified release bundle, packaging, fuses, and
  packaged smoke limitations from Phase 1 remain.

## 17. Next phase plan

Phase 3 will add Pi SDK runtime isolation only after verifying the exact
maintained SDK package, installed APIs/types, and official sources:

1. select and lock the exact Pi SDK packages without installing/updating any
   Codex Skills;
2. define a versioned Main/Agent Utility Process protocol with request,
   session, runtime-generation, and event identities;
3. supervise worker start/stop/restart/status/exit and bounded redacted
   diagnostics;
4. initialize actual ModelRuntime, resource loader, agent session runtime, and
   session manager APIs in the worker;
5. expose only minimal runtime status operations through the existing validated
   Main/preload boundary;
6. test protocol, stale-event rejection, crash isolation, cleanup, Electron
   startup, and all frozen visuals.
