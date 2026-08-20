# Phase 0 Report - Audit, UI Lock, and Engineering Baseline

Date: 2026-08-07

> **Historical snapshot (2026-08-07):** This report preserves the evidence and
> assumptions of Phase 0. It is not current product or release authority. See
> [the documentation index](README.md), [Architecture](ARCHITECTURE.md),
> [Packaging](PACKAGING.md), and [Test Matrix](TEST_MATRIX.md).

## 1. Phase name

Phase 0 - Project audit, UI lock, and engineering baseline.

## 2. Completed work

- Inspected the complete repository file list, dependency manifest, pnpm
  workspace configuration, Vite configuration, TypeScript configuration, and
  existing test inventory.
- Read App, layout, chat, Markdown, inspector, settings, settings-store, theme,
  i18n, type, and mock-data implementations named by the project objective.
- Verified the current application in a fixed 1440 x 900 browser viewport and
  found no console warnings/errors.
- Established that the worktree is a browser-only Vite/React renderer with no
  Electron runtime, preload, Pi SDK, utility process, or pre-existing tests.
- Mapped every current workspace/session/message/model/file/diff/terminal/log
  surface to renderer mock state.
- Added repository engineering rules, UI freeze contract, project constraints,
  target architecture, and ordered implementation plan.
- Added deterministic Playwright visual coverage for eight required states and
  committed platform-specific macOS baselines.
- Added comparison-only test scripts and ignored generated reports/artifacts.

## 3. Modified files

- `AGENTS.md`
- `docs/UI_FREEZE.md`
- `docs/PROJECT_CONSTRAINTS.md`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/PHASE_0_REPORT.md`
- `playwright.config.ts`
- `tests/visual/pipilot.visual.spec.ts`
- `tests/visual/__screenshots__/darwin/*.png`
- `package.json`
- `pnpm-lock.yaml`
- `tsconfig.json`
- `.gitignore`

## 4. Purpose of each modified file

| File | Purpose |
| --- | --- |
| `AGENTS.md` | Repository-wide UI, security, dependency, process, and verification rules |
| `docs/UI_FREEZE.md` | Normative frozen UI and visual baseline contract |
| `docs/PROJECT_CONSTRAINTS.md` | Process boundaries, security, reliability, data, and test invariants |
| `docs/ARCHITECTURE.md` | Current-state audit and target Electron/Pi process architecture |
| `docs/IMPLEMENTATION_PLAN.md` | Ordered Phase 0-13 plan and acceptance gates |
| `docs/PHASE_0_REPORT.md` | Durable record of Phase 0 evidence and remaining work |
| `playwright.config.ts` | Fixed visual environment, Chrome runner, Vite server, output paths, and baseline-update lock |
| `tests/visual/pipilot.visual.spec.ts` | Eight deterministic dark/light state comparisons |
| `tests/visual/__screenshots__/darwin/*.png` | Eight approved 1440 x 900 initial reference images |
| `package.json` | Add typecheck and visual comparison scripts plus Playwright dev dependency |
| `pnpm-lock.yaml` | Lock the added test dependency graph |
| `tsconfig.json` | Type-check Playwright config and visual tests with application code |
| `.gitignore` | Ignore test reports, transient Playwright output, MCP artifacts, and local skill symlinks |

No file under `src/` was modified by Phase 0.

## 5. Dependency added and reason

`@playwright/test@1.62.1` was added as a development dependency. Playwright MCP
supports interactive inspection in an agent session but is not a repository
test runner and cannot provide a committed CI command, screenshot assertions,
reference lookup, or failure diff artifacts. No Playwright browser bundle was
downloaded; the suite uses the installed stable Google Chrome.

No Vitest dependency was added. There is no Phase 0 application logic requiring
unit tests, and Vitest will be introduced when testable desktop modules exist.

## 6. New IPC

None. Electron and IPC implementation begins in Phase 1.

## 7. New shared types

None. The target shared type locations and ownership are documented only.

## 8. New runtime schemas

None. Runtime validation begins with the Phase 1 IPC contracts.

## 9. Tests added

`tests/visual/pipilot.visual.spec.ts` covers:

- main dark idle;
- main light idle;
- main dark running;
- main light running;
- main dark waiting approval;
- main light waiting approval;
- settings dark;
- settings light.

The tests pin viewport, device scale, browser channel, locale, timezone, clock,
theme, fonts, font sizes, density, reduced motion, and mock data. Expected,
actual, trace, and diff outputs are retained on failure in ignored directories.

## 10. Verification commands

- `pnpm dev --host 127.0.0.1`
- `pnpm typecheck`
- `pnpm exec playwright test --update-snapshots=missing`
- `pnpm test:visual`
- `pnpm build`
- focused `git diff --check`, image metadata, ignore-rule, and index-mode checks

## 11. Real result of each command

### Browser startup and inspection

- `pnpm dev --host 127.0.0.1`
  - Initial sandbox run: failed with `listen EPERM`.
  - Approved local-server run: started successfully at
    `http://127.0.0.1:3000/`.
  - Fixed-viewport DOM and screenshot inspection: succeeded.
  - Browser console warning/error query: zero entries.

### TypeScript

- First `pnpm typecheck`: failed because installed Playwright 1.62 types did not
  accept `reducedMotion` in the selected config overload.
- The test was corrected to use the installed `page.emulateMedia()` API.
- Second `pnpm typecheck`: passed with `tsc --noEmit` and no diagnostics.

### Visual baseline creation and comparison

- `pnpm exec playwright test --update-snapshots=missing`
  - All eight scenarios reached their screenshot assertions.
  - Playwright wrote the eight missing initial images and returned failure for
    the first run because no references existed before that run.
- Manual image audit:
  - all eight images inspected;
  - each is 1440 x 900 RGB PNG;
  - each shows the intended theme/state/settings surface;
  - no unexpected layout, typography, theme, card, or spacing change observed.
- `pnpm test:visual`
  - 8 passed, 0 failed, 12.6 seconds.
  - This ordinary command contains no snapshot-update flag and runs with
    `updateSnapshots: 'none'`.

### Production build

- `pnpm build`
  - TypeScript passed.
  - Vite 8.2.0 transformed 620 modules and built successfully in 239 ms.
  - Outputs: 1.63 kB HTML, 77.28 kB CSS, and 797.80 kB JS before gzip.
  - Vite emitted a non-fatal warning for a JavaScript chunk above 500 kB.

### Repository checks

- `git diff --check` on tracked Phase 0 text changes: passed.
- Eight baseline PNG files found; all are 1440 x 900.
- Baseline images are not ignored; transient reports are ignored.
- Git index contains no mode `120000` symlink entry.

## 12. UI files modified

No.

This phase did not modify the frozen UI, theme tokens, typography, spacing,
density, Markdown styles, or visible component structure.

## 13. UI modification necessity

Not applicable. Deterministic state setup happens only in the Playwright test
environment through existing controls and localStorage-backed settings.

## 14. Visual regression result

Passed: 8 of 8 on macOS (`darwin`) with stable Google Chrome, 1440 x 900 CSS
viewport, device scale factor 1, fixed clock/locale/timezone, and reduced motion.

The initial reference set was manually inspected. Future regular runs compare
only. Other operating systems need separately reviewed platform baselines.

## 15. Mock data still in use

All business data remains mocked, as required for Phase 0:

- workspace and recent projects;
- session list and titles;
- model/provider list and context usage;
- user/agent messages;
- tool calls and approval request;
- file tree and selected file;
- diffs;
- terminal output/input shell behavior;
- logs;
- settings persistence through renderer localStorage;
- update/about runtime and platform information.

Markdown rendering, local theme/font/density application, i18n switching, and
component interactions are real renderer behavior but have no desktop backend.

## 16. Known issues

- No Electron, preload, IPC, Pi SDK, utility process, persistence repository,
  real workspace/session runtime, PTY, credential store, or packaging exists.
- The technical npm package and mock workspace still use the legacy
  `pi-agent-desktop` identifier; visible product branding is PiPilot. Metadata
  will be normalized when desktop package identity is introduced.
- The production renderer has one 797.80 kB pre-gzip JavaScript chunk and emits
  Vite's size warning. Phase 1 build boundaries should reassess code splitting
  without changing UI.
- Fonts are loaded through the existing Google Fonts links. Visual tests wait
  for Inter and JetBrains Mono before capture and fail rather than update if the
  environment cannot load them. Packaging must make approved fonts available
  without relying on a renderer network exception.
- The current mock idle transition leaves the already-resolved approval copy in
  its existing demo state. It is frozen as the initial reference; the real state
  reducer in Phases 5-6 must make lifecycle text truthful without restyling it.

## 17. Next phase plan

Phase 1 will add the Electron secure foundation only:

1. verify current Electron and Vite integration APIs and select the minimal
   compatible build path;
2. introduce Main, preload, shared IPC/error/schema contracts, and desktop
   development/production entries;
3. enforce renderer isolation, sender validation, CSP, navigation, popup, and
   external-link policies;
4. persist and clamp window state;
5. add focused security/IPC tests and an Electron startup smoke test;
6. rerun all eight visual references and confirm no renderer visual change.

Pi SDK and business-data integration remain out of scope until their ordered
phases.
