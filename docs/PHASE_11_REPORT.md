# Phase 11 Report - Complete Test System and CI

Date: 2026-08-08

> **Historical snapshot (2026-08-08):** This report preserves the evidence and
> assumptions of Phase 11. It is not current product or release authority. See
> [the documentation index](README.md), [Architecture](ARCHITECTURE.md),
> [Packaging](PACKAGING.md), and [Test Matrix](TEST_MATRIX.md).

## 1. Phase name

Phase 11 - Complete unit, integration, Electron E2E, visual, security, cleanup,
and CI gates.

## 2. Completed work

- Audited all 16 existing Vitest files and nine Electron scenarios against the
  exact Phase 11 matrix before adding coverage.
- Kept Vitest and Playwright as the only test frameworks. No duplicate runner,
  browser package, testing utility, or coverage dependency was introduced.
- Extracted the existing session list mapping into a pure `deriveSessionState`
  function and added the missing unit coverage for active identity, pin/recent
  ordering, title fallback, and empty state.
- Added a dedicated Playwright integration configuration selecting six actual
  Electron full-stack scenarios for Main/preload, Main/worker, session
  replacement/rebinding, persistence/crash recovery, filesystem, permissions,
  PTY, and credential storage.
- Extended Electron UI workflow evidence to select Logs, open Settings, switch
  dark/light themes through the radio controls, switch Chinese/English through
  the language controls, and verify persisted DOM/settings state.
- Confirmed every Electron test uses temporary `userData`, closes its app in
  `finally`, and the PTY scenario observes its cleanup trap after app exit.
- Added deterministic dark/light failed visual states behind a visual-server-
  only Vite environment flag. Normal browser preview, production builds, and
  Electron do not read or expose that fixture.
- Added two new failed-state baselines, visually inspected both at 1440 x 900,
  and verified all ten images with the normal comparison-only command. The
  existing eight baselines were not regenerated.
- Strengthened font determinism: a visual test now fails unless loaded Inter and
  JetBrains Mono FontFace entries actually exist, preventing silent fallback.
- Added a GitHub Actions workflow with read-only contents permission, frozen
  pnpm install, pinned Node/pnpm, macOS 26, sequential one-worker gates, timeout,
  concurrency cancellation, and failure-only artifacts. It contains no
  baseline-update command.
- Added `docs/TEST_MATRIX.md` mapping every unit, integration, E2E, visual,
  security, cleanup, and CI requirement to executable evidence.

## 3. Modified files

- `package.json`
- `playwright.config.ts`
- `playwright.electron.config.ts`
- `playwright.integration.config.ts`
- `.github/workflows/ci.yml`
- `src/App.tsx`
- `src/store/workspace.tsx`
- `src/store/workspace-state.ts`
- `tests/unit/session-state.test.ts`
- `tests/electron/pipilot.electron.spec.ts`
- `tests/visual/pipilot.visual.spec.ts`
- `tests/visual/__screenshots__/darwin/main-dark-failed.png`
- `tests/visual/__screenshots__/darwin/main-light-failed.png`
- `docs/TEST_MATRIX.md`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/PHASE_11_REPORT.md`

## 4. Purpose of each modified file

| File/group | Purpose |
| --- | --- |
| package/test configs | Explicit unit/integration/Electron/visual commands, one-worker deterministic suites, no focused tests, and no visual updates |
| GitHub Actions workflow | Frozen install and required CI gates on the reviewed macOS/Darwin environment |
| App visual fixture | Test-server-only failed runtime status and response-error turn with no normal-mode effect |
| workspace state/store | Pure session derivation boundary used by production and direct unit coverage |
| unit test | Missing session-state matrix evidence |
| Electron test | Visible Logs/Settings/theme/language workflow in the existing temporary-userData scenario |
| visual test/baselines | Failed dark/light states and actual font loading enforcement |
| matrix/report/architecture/plan | Traceable coverage, exact results, completion state, limitations, and Phase 12 handoff |

## 5. Dependencies added and reason

None.

Vitest 4.1.10 and Playwright 1.62.1 were already installed and sufficient.
Playwright MCP remains an interactive inspection capability; it cannot replace
the checked-in test dependency/configuration or a CI runner. No local browser,
Codex/agent Skill, test utility, CI helper package, or coverage package was
installed.

Current CI references were verified against official sources before writing the
workflow:

- <https://playwright.dev/docs/ci>
- <https://github.com/actions/setup-node>
- <https://github.com/pnpm/action-setup>
- <https://github.com/actions/runner-images>

## 6. New IPC

None.

Phase 11 tests the existing named IPC and private Agent protocol boundaries; it
does not widen preload or add a generic transport.

## 7. New shared types

None.

`deriveSessionState` is an internal pure store function returning the existing
Renderer `Session[]` and active ID types. No public/preload/worker contract was
added or changed.

## 8. New runtime schemas

None.

Existing strict Zod schemas are exercised across the completed matrix. The
visual fixture is compile-time Vite test-server configuration, not an IPC or
runtime data schema.

## 9. Tests added or changed

- Added two Vitest session-state tests; the complete suite is now 17 files and
  112 tests.
- Added a six-scenario `test:integration` gate reusing the actual Electron
  harness without copied fixtures.
- Extended the first Electron scenario to cover Logs and visible theme/locale
  settings controls; all nine E2E scenarios remain full-stack and isolated.
- Expanded visual comparison from eight to ten cases with failed dark/light.
- Added actual loaded-font assertions for Inter and JetBrains Mono.
- Added `forbidOnly: true` to Electron Playwright configuration.
- Added a CI workflow executing every required gate with a frozen lockfile.

The exact per-requirement mapping is in `docs/TEST_MATRIX.md`.

## 10. Verification commands

- official Playwright CI, setup-node, pnpm action, and GitHub runner-image
  documentation inspection;
- bundled offline pnpm `run typecheck`;
- focused session-state Vitest run;
- Playwright integration and visual `--list` discovery;
- one-time focused creation of only the two missing failed baselines;
- image inspection and `sips` dimension checks;
- bundled offline pnpm `run build`;
- bundled offline pnpm `run test:integration`;
- focused rerun after the one integration assertion correction;
- bundled offline pnpm `run test:electron`;
- comparison-only bundled offline pnpm `run test:visual`;
- bundled offline pnpm `run test:unit`;
- bundled offline pnpm `peers check`;
- locale parity and Ruby YAML parsing scripts;
- repository/staged/baseline/artifact/symlink hygiene checks.

## 11. Real result of each command

### Static, unit, and build

- Standalone TypeScript checking passed.
- Focused session-state run passed 1 file and 2 tests in 174 ms.
- Final unit suite passed 17 files and 112 tests in 991 ms.
- Production build ran its own `tsc --noEmit`; both passed.
- Build transformed 41 Main modules and emitted protocol 25.20 kB, Agent Worker
  78.87 kB, and Main 192.80 kB.
- Preload transformed 90 modules and emitted 196.67 kB.
- Renderer transformed 738 modules and emitted HTML 1.56 kB, initial CSS
  96.52 kB, initial JavaScript 2,078.24 kB, and lazy Terminal chunks of CSS
  7.11 kB and JavaScript 568.98 kB.
- Locale parity passed with 455 keys in each catalog.
- `pnpm peers check`: no peer dependency issues.
- Ruby parsed `.github/workflows/ci.yml` and found the `verify` job. The workflow
  has not been pushed or executed by GitHub Actions in this worktree, so no
  remote CI success is claimed.

### Integration and Electron E2E

- Test discovery selected exactly 6 integration scenarios.
- The first integration run passed 5/6. The new Logs assertion incorrectly
  expected browser mock entries although the Electron scenario intentionally
  had no active workspace and truthfully displayed `No logs yet`.
- After changing only that assertion, its focused rerun passed in 4.1 s. The
  final exact `pnpm test:integration` gate then passed all 6 tests in 22.9 s.
- Complete Electron E2E passed all 9 tests in 35.4 s.
- The suite exercised temporary userData, real Electron safeStorage, Pi Utility
  Process crash/restart, session replacement, streaming/Markdown, real tool
  approval allow/deny, Files/Diff, node-pty cleanup, Resources, Logs, Settings,
  themes, locales, workspace isolation, and relaunch persistence.

### Visual regression

- Visual discovery selected exactly 10 scenarios.
- The one-time focused baseline command created only
  `main-dark-failed.png` and `main-light-failed.png`; 2 tests passed in 5.2 s.
- Both images were inspected at original resolution and measured 1440 x 900.
  Failure label/notice, three columns, cards, Composer, and Inspector were
  visible without overlap in dark or light mode.
- After actual font loading assertions were added, final comparison-only visual
  regression passed all 10 cases in 15.9 s with zero pixel tolerance.
- The prior eight baseline files were not regenerated or changed.

### Repository checks

- `git diff --check` passed and the newly added workflow, TypeScript, tests, and
  documentation have no trailing whitespace.
- The staged diff is empty. No Phase 11 file, local Skill link, or deletion is
  staged.
- `test-results/` is ignored; failure screenshots, traces, and error context are
  not delivery source files.
- The worktree's visual source directory is still untracked as part of the
  larger uncommitted phase sequence. The focused baseline command output
  confirms it wrote only the two new failed files; the normal command remained
  comparison-only.
- Eight machine-local links exist under `.agents/skills`, while every historical
  indexed Skill entry remains regular-file mode `100644`. The index has no mode
  `120000`; replacement/deletion noise remains untouched and unstaged.

## 12. UI files modified

- `src/App.tsx`
- `tests/visual/pipilot.visual.spec.ts`
- two new failed-state baseline images

`src/App.tsx` changes are reachable only when the visual Playwright server sets
`VITE_PIPILOT_VISUAL_TEST=1` and local storage requests the failed fixture.
Normal browser preview, production build, and Electron behavior/DOM are
unchanged. No global CSS, theme token, geometry, typography, spacing, radius,
border, Markdown style, ToolCallCard, or ApprovalCard source was changed.

## 13. UI modification necessity

Phase 11 explicitly requires a failed visual state in both themes. The minimal
test-only fixture sets the existing Agent status to `failed`, removes the
pending approval fixture, and appends the existing localized response-error
notice. It reuses the frozen ChatHeader, MessageList, Composer, tool cards, and
layout rather than adding a production control or user-visible instruction.

本阶段仅增加视觉测试服务器专用的失败状态和两张新基线；正常浏览器与 Electron UI 不变，也未修改三栏布局、主题 Token、字号、间距、圆角、边框、Markdown 或卡片结构。

## 14. Visual regression result

Passed: 10/10 reviewed macOS dark/light references at 1440 x 900 and zero pixel
tolerance. This includes idle, running, waiting approval, failed, and Settings
in both themes. Inter and JetBrains Mono are verified as loaded FontFace entries.
No existing baseline was regenerated.

## 15. Mock data still in use

- Browser preview and visual tests intentionally retain the approved static
  content fixture; only the visual server can select its deterministic failed
  status.
- Electron E2E uses the real Pi runtime/session/loader with PiPilot's explicit
  faux Provider and local deterministic extension/tool fixtures, so it does not
  make external model calls.
- Inspector Logs remains a truthful empty/static presentation surface; Phase 11
  verifies tab behavior but does not invent a production logging transport.

## 16. Known issues

- The GitHub Actions workflow is locally syntax-checked but has not run on a
  remote repository. Its first real run may expose hosted-image or entitlement
  differences that cannot be claimed locally.
- Local integration/E2E/visual evidence is macOS arm64. Windows and Linux
  packaged behavior, native PTY artifacts, and installers remain Phase 12.
- Visual tests use the system Google Chrome channel and Google-hosted Inter/
  JetBrains Mono files. The new FontFace assertions fail closed instead of
  accepting fallback fonts, but upstream browser/font availability remains an
  external CI input.
- The integration gate intentionally reruns six scenarios also present in the
  complete Electron gate. This costs about 23 seconds locally but avoids a
  divergent duplicate harness and keeps the named boundary gate auditable.
- Coverage percentage is not a goal and no coverage threshold/package was
  added; the matrix is behavioral and risk-based.
- Bare Corepack pnpm remains unusable without registry access in this sandbox;
  local verification used the bundled pnpm executable and existing lockfile.

## 17. Next phase plan

Phase 12 will produce and inspect installable artifacts:

1. inspect the current electron-vite/build/native-module output and installed
   packager options before choosing the smallest established packaging path;
2. configure PiPilot product metadata, app ID, icons, asar, unpack rules,
   Utility Process/Pi resources, production/crash logs, and native PTY rebuild;
3. exclude tests, test artifacts, source-only files, secrets, user paths, and
   local Skill/MCP configuration from packages;
4. define Windows x64, macOS arm64/x64, and Linux x64 targets without claiming
   unexercised signing or notarization;
5. build the host artifact and smoke-test packaged startup, worker, settings,
   themes, workspace, and session creation;
6. record exact artifact contents, sizes, platform gaps, credentials not used,
   and real command results before Phase 13 review.

## Completion audit addendum - 2026-08-08

Final acceptance coverage added only stable gaps discovered by the audit:

- locale catalogs now have an executable parity/placeholder contract test;
- session-state tests cover 50-row pagination and active-session page routing;
- Electron E2E covers UI/mono fonts at 18 px, comfortable density, reduced
  motion, keyboard panel resizing, and 125%/150% Electron zoom;
- visible recent-project pin/open/unpin persistence, successful and rejected
  model selection, high thinking level, and both required memory extensions are
  exercised through the existing complete Electron harness.

The current final gates passed 23 unit files / 139 tests, integration 6/6,
Electron E2E 9/9, visual comparison 10/10, and packaged smoke 1/1. The visual
command remained comparison-only and no baseline file changed.
