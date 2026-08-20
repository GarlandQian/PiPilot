# Phase 12 Report - Packaging and Distribution

Date: 2026-08-08

> **Historical snapshot (2026-08-08):** This report preserves the evidence and
> assumptions of Phase 12. It is not current product or release authority. See
> [the documentation index](README.md), [Architecture](ARCHITECTURE.md),
> [Packaging](PACKAGING.md), and [Test Matrix](TEST_MATRIX.md).

## 1. Phase name

Phase 12 - Installable platform targets, secure package contents, native
dependencies, packaged-runtime diagnostics, and packaged application smoke.

## 2. Completed work

- Extended the existing electron-vite build with electron-builder 26.15.7; no
  Electron Forge migration or second packaging stack was introduced.
- Configured `PiPilot`, `com.pipilot.desktop`, version `0.1.0`, branded icons,
  ASAR, native rebuilds, locale pruning, deterministic artifact names, and an
  ignored `release/` output directory.
- Configured macOS arm64/x64 DMG and ZIP, Windows x64 NSIS, and Linux x64
  AppImage/DEB targets. Publishing and auto-update are disabled.
- Restricted packaged source to compiled output, package metadata, and
  production dependencies. Source, tests, reports, maps, local MCP/agent
  configuration, environment files, generated artifacts, and user paths are
  excluded.
- Kept Pi SDK packages and the Agent Worker in ASAR while unpacking native
  `node-pty` and target-native Pi clipboard binaries as required.
- Added local Inter v20 and JetBrains Mono v24 WOFF2 assets and OFL licenses,
  removed runtime Google font requests, and tightened production CSP to local
  style/font sources.
- Added a current official `@electron/fuses` 2.1.3 build dependency because
  electron-builder's transitive 1.8.0 release could not name Electron 43's
  `WasmTrapHandlers` fuse. A strict after-pack hook now requires explicit
  values for every fuse before signing.
- Added valid local macOS ad-hoc signing after fuse mutation. Kept real
  Developer ID signing, hardened runtime, entitlements, forced signing, and
  notarization in a separate release configuration that fails without real
  credentials.
- Separated packaged browser data, fixed-code production logs, and local crash
  dumps under `userData`; disabled crash upload and bounded log rotation.
- Fixed fresh packaged Agent startup so an empty credential repository returns
  immediately without probing macOS safeStorage/Keychain when nothing needs
  decryption. Configured credentials retain the encrypted path.
- Added package-storage/diagnostic unit tests and a CDP-based packaged smoke
  test that inspects contents and exercises the primary packaged workflow.
- Added a manual native GitHub Actions packaging matrix for macOS, Windows, and
  Linux with frozen installs and unpublished validation artifacts.

## 3. Modified files

- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `.gitignore`
- `electron-builder.yml`
- `electron-builder.release.yml`
- `build/apply-electron-fuses.cjs`
- `build/icon.svg`
- `build/icon.png`
- `build/entitlements.mac.plist`
- `build/entitlements.mac.inherit.plist`
- `index.html`
- `public/fonts/fonts.css`
- `public/fonts/*.woff2`
- `public/fonts/OFL-Inter.txt`
- `public/fonts/OFL-JetBrains-Mono.txt`
- `src/main/application-storage.ts`
- `src/main/diagnostics/main-diagnostics.ts`
- `src/main/index.ts`
- `src/main/security/session-security.ts`
- `src/main/repositories/credential-repository.ts`
- `playwright.packaged.config.ts`
- `tests/packaged/pipilot.packaged.spec.ts`
- `tests/unit/packaging-runtime.test.ts`
- `tests/unit/credential-repository.test.ts`
- `.github/workflows/release.yml` (the later unified public release workflow)
- `tsconfig.json`
- `docs/PACKAGING.md`
- `docs/TEST_MATRIX.md`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/PHASE_12_REPORT.md`

## 4. Purpose of each file group

| File/group | Purpose |
| --- | --- |
| package metadata/lock/workspace policy | Exact packaging/fuse dependencies, platform scripts, frozen resolution, and native build permissions |
| electron-builder configs | Base validation targets and separate credential-required macOS release path |
| build resources/hook | Branded icon, entitlements, and strict current Electron fuse application before signing |
| local fonts/CSP | Offline packaged typography with licenses and no production font network dependency |
| application storage/diagnostics | Browser/log/crash separation, owner-only directories/files, code-only logs, rotation, and safe smoke override |
| credential repository | Avoid a needless first-run Keychain probe for an empty credential set |
| packaged Playwright config/test | ASAR/native inspection and real packaged primary workflow through isolated CDP |
| unit tests | Storage paths, override containment, log safety/rotation, and empty safeStorage behavior |
| package workflow | Native macOS/Windows/Linux build and smoke matrix, later superseded by the unified public release workflow |
| docs | Operator commands, security boundary, exact evidence, unverified claims, and Phase 13 handoff |

## 5. Dependencies added and reason

- `electron-builder@26.15.7` as an exact development dependency: creates the
  required native installers, ASAR, native rebuilds, icons, signing hooks, and
  platform metadata from the existing electron-vite output. No equivalent
  package existed in the project.
- `@electron/fuses@2.1.3` as an exact development dependency: covers the full
  Electron 43 fuse wire, including `WasmTrapHandlers`, and supports strict
  completeness. electron-builder 26.15.7's transitive `@electron/fuses@1.8.0`
  reported that fuse as `undefined`, so it was not sufficient for an explicit
  upgrade-safe security gate.

No updater, publisher, signing helper, font package, second test runner,
Playwright browser, MCP server, Codex/agent Skill, or Electron Forge dependency
was installed. Playwright MCP remains useful for interactive inspection but
does not replace the repository Playwright package, checked-in smoke test, or
CI runner.

## 6. Packaging configuration

- Windows: NSIS x64, assisted per-user install, Start Menu and desktop
  shortcuts, no automatic app-data deletion.
- macOS: arm64/x64 DMG and ZIP, developer-tools category, dark-mode metadata,
  ad-hoc local validation identity, and no local notarization.
- Linux: x64 AppImage and DEB, Development category, `pipilot` executable.
- Artifact pattern: `PiPilot-0.1.0-${arch}.${ext}`.
- Electron locales: `en-US` and `zh-CN`.
- ASAR integrity data is embedded by electron-builder; only application code
  from ASAR is loadable.

The separate release configuration requires `${env.CSC_NAME}`, forces code
signing, enables hardened runtime, applies entitlements, and enables
notarization. It was not executed.

## 7. IPC and shared contracts

No public IPC channel, preload method, or Renderer capability was added.

The packaged smoke test uses the already frozen typed `window.pipilot` facade.
Its userData override is accepted only in packaged smoke mode and only for a
canonical OS-temporary directory whose top-level name starts with
`pipilot-packaged-smoke-`; this is not a generic path override.

## 8. Production storage and diagnostic behavior

- Electron `userData` remains the mutable root.
- Chromium `sessionData` is moved to `browser-data/`.
- Electron application logs and PiPilot fixed-code logs use `logs/`.
- Local crash dumps use `crash-reports/` and are not uploaded.
- Main logs are JSON lines containing timestamp, level, and normalized code
  only. Unsafe codes are replaced rather than copied.
- `main.log` rotates at 1 MiB to one recoverable `main.previous.log`.
- Directories use mode `0700` and files mode `0600` where supported.

No raw worker stdout/stderr, error objects, stack traces, secrets, workspace
paths, agent paths, or user paths are written to production diagnostics.

## 9. Packaged smoke coverage

The one packaged scenario:

1. resolves the current platform unpacked executable;
2. reads ASAR with electron-builder's bundled ASAR API;
3. asserts Main, preload, Renderer, Agent Worker, Pi AI, and Pi Coding Agent are
   present;
4. rejects source/test/config/report roots and test artifacts;
5. confirms a native unpacked `node-pty` binding;
6. launches the secure-fuse application with temporary userData, agent data,
   workspace, and Chromium profile;
7. verifies `pipilot://app/`, production mode, storage/log/crash paths, and
   path-free production logs;
8. explicitly loads local Inter and JetBrains Mono;
9. changes locale and light/dark theme through the existing UI/facade;
10. opens a real temporary recent workspace;
11. waits for the real Agent Utility Process and session identity;
12. creates a new session through the visible control and verifies the runtime
    adopted its new ID;
13. verifies settings/workspace persistence and cleans every temporary path.

Chromium 136+ requires a non-default `--user-data-dir` alongside
`--remote-debugging-port`; the smoke test supplies an isolated temporary value.
Normal production startup does not enable CDP. The secure Node CLI inspect fuse
remains disabled.

## 10. Verification commands

- official Electron, electron-builder, Chrome remote-debugging, GitHub runner,
  Inter, and JetBrains Mono documentation/source inspection;
- exact pnpm dependency installation and frozen lock update;
- `plutil -lint` for both entitlement files;
- WOFF2 type and local icon image inspection;
- bundled pnpm TypeScript/production builds through `package:dir` and
  `package:mac`;
- bundled pnpm `test:unit`, `test:integration`, `test:electron`,
  comparison-only `test:visual`, and `test:packaged`;
- `codesign --verify --deep --strict` on arm64 and x64 applications;
- current `electron-fuses read` on arm64 and x64 applications;
- `file` inspection of both application executables and both unpacked
  `node-pty` binaries;
- Info.plist identity/version extraction;
- ASAR absolute-host-path scan and packaged-content assertions;
- artifact size and SHA-256 calculation;
- repository, baseline, ignored-output, staged-diff, and local Skill-link
  hygiene inspection.

## 11. Real results

### Build and package

- Final `package:mac` completed successfully for x64 and arm64.
- Main transformed 46 modules and emitted protocol 25.20 kB, Agent Worker
  82.85 kB, and Main 208.62 kB.
- Preload transformed 90 modules and emitted 196.75 kB.
- Renderer transformed 740 modules and emitted HTML 1.26 kB, initial CSS
  96.59 kB, initial JavaScript 2,088.71 kB, and Terminal CSS/JavaScript chunks
  of 7.11/569.09 kB.
- The final arm64 `.app` is approximately 291 MiB, with a 56 MiB ASAR and
  6.7 MiB unpacked native resources.
- Info.plist contains `com.pipilot.desktop`, `PiPilot`, and version/build
  `0.1.0`.
- arm64/x64 application executables and `pty.node` files report matching
  Mach-O architectures.
- Both application bundles pass deep strict code-signature integrity checks.
  The signature is explicitly ad-hoc, has no Team ID, and is not a
  distribution signature.
- Both architectures report all nine Electron 43 fuses by name and with the
  configured values. Strict fuse application completed before signing.
- The ASAR scan found no absolute developer host-path string.

Final local artifacts, refreshed by the completion-audit rebuild:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `PiPilot-0.1.0-arm64.dmg` | 121,856,780 | `02e496bbed98734518e3f2b2c58c4d93d57186dabee2b2d369934c673ed5a041` |
| `PiPilot-0.1.0-arm64.zip` | 118,029,304 | `e20f10a37879fd22296abd36671aae8cbdb6e96de9dc4877ec14bedb8a82f51f` |
| `PiPilot-0.1.0-x64.dmg` | 126,977,402 | `4e852fec4c9192d39ddc92e7dccc6b04c17d32b46838a1d1e63f89b3a9ad8df1` |
| `PiPilot-0.1.0-x64.zip` | 123,153,955 | `84d33bf0c7da18c8eeff56199e60b7719b271db2adee18d40bd55183a6738b8c` |

These generated files are ignored and are local validation evidence, not
source or published releases.

### Tests

- Final unit suite passed 23 files and 139 tests.
- The final exact integration gate passed all 6 full-stack scenarios in 17.8
  seconds.
- Complete Electron E2E passed 9/9 scenarios in 29.4 seconds.
- Comparison-only visual regression passed 10/10 scenarios in 10.3 seconds
  with no baseline update.
- Final packaged smoke passed 1/1 in 7.2 seconds against the arm64 application
  produced by the final dual-architecture package command.

The original Phase 12 credential regression was verified before phase closure.
Phase 13 subsequently reran the complete Electron and visual gates, refreshed
the dual-architecture packages, and repeated the packaged Agent workflow; the
current counts and artifact hashes above are from that later final worktree.

### Expected warnings

- node-gyp printed its known warning about a space in the repository path while
  rebuilding x64 and arm64 `node-pty`; each rebuild completed, and both final
  native binaries were independently verified for architecture.
- electron-builder reported non-host optional clipboard binaries while
  packaging on macOS. The installed Darwin arm64 and universal binaries were
  present and valid. Native Windows/Linux jobs install their own optional
  packages from the lockfile; those jobs remain unexecuted.

## 12. Failures found and corrected

- A sandboxed first package attempt could not resolve the Electron download
  host. The approved networked rerun downloaded the official Electron artifact
  and succeeded.
- Playwright's Electron launcher injects `--inspect=0`, correctly rejected by
  the disabled Node CLI inspect fuse. The packaged test now spawns the app and
  attaches only to a Chromium CDP port with an isolated non-default profile.
- Chromium initially ignored the CDP flag because Chromium 136+ requires a
  non-default `--user-data-dir`. The smoke-only temporary profile fixed this
  without altering normal production startup.
- Setting macOS identity to `null` skipped all signing after fuse mutation, so
  macOS killed the app and `codesign --verify` reported invalid resources. The
  base config now uses supported ad-hoc signing after fuse changes; the release
  config remains credential-required.
- The transitive old fuse reader could not name Electron 43's ninth fuse. The
  current direct official dependency and strict hook now name and configure all
  nine.
- A fresh packaged app reached the worker but stayed `starting`: the empty
  credential repository unnecessarily waited on async safeStorage/Keychain.
  Empty repositories now return without probing encryption, with a regression
  test proving zero availability checks. The final packaged smoke passes.

Temporary raw worker diagnostics used to locate the Keychain wait were removed
before the final build. Production still records only the fixed
`AGENT_RUNTIME_AGENT_WORKER_STDERR` code when worker stderr exists.

## 13. UI files modified and necessity

- `index.html` now links local packaged font CSS and removes Google Fonts
  preconnect/stylesheet URLs.
- `public/fonts/` contains the exact local WOFF2 subsets and OFL licenses.

No React component, three-column geometry, theme token, color, font family,
font size, density, spacing, radius, border, Markdown style, ToolCallCard, or
ApprovalCard visual was changed for packaging. Local fonts preserve the
existing Inter and JetBrains Mono families and weights while removing a runtime
network dependency.

本阶段没有重设计界面；仅把现有字体改为随应用本地打包，保留三栏布局、主题、字号、间距、圆角、Markdown 与工具/审批卡片视觉。

## 14. Visual regression result

Passed 10/10 dark/light comparisons after font localization. The command was
comparison-only. No approved baseline image was modified or regenerated in
Phase 12.

## 15. Signing, notarization, and release truth

- Verified: local macOS ad-hoc signature integrity for arm64 and x64.
- Configured but not executed: Developer ID signing, hardened release runtime,
  and Apple notarization.
- Configured but not executed locally: Windows x64 NSIS, Linux x64 AppImage and
  DEB, and their native packaged smoke runs.
- Not configured as complete: publishing and auto-update.

There is no claim of Apple Team ID, Developer ID trust, notarization ticket,
Gatekeeper acceptance, Windows Authenticode, remote CI success, published
artifact, update feed, or rollback validation.

## 16. Repository hygiene

- `release/`, `test-results/`, and packaging block maps are ignored.
- No generated artifact or test failure output is a delivery source file.
- The staged diff remains empty.
- Machine-local `.agents/skills` symlink/deletion noise was not edited, staged,
  restored, or included in packaging.
- No visual baseline changed.

## 17. Known issues and Phase 13 completion

- Windows/Linux and macOS x64 launch behavior require their native CI jobs;
  only macOS arm64 was launched locally.
- Real macOS/Windows signing, Apple notarization, publishing, and auto-update
  need credentials and external release infrastructure not in scope.
- Renderer initial JavaScript remains above 2 MiB; this is an optimization
  opportunity, not a Phase 12 packaging failure.
- Pi's optional clipboard packages produce non-host warnings during a macOS
  build; native platform CI must prove each target's selected optional binary.
- The manual package workflow has not run remotely.

Phase 13 audited the final packaged system, fixed every identified
Blocker/High finding, and retained the public-distribution hold. Its fresh
evidence is recorded in `docs/PHASE_13_REPORT.md`; the 38-item final mapping is
in `docs/COMPLETION_AUDIT.md`.

Authoritative sources used:

- <https://github.com/electron-userland/electron-builder/releases>
- <https://www.electron.build/docs/configuration/>
- <https://www.electron.build/docs/contents/>
- <https://www.electron.build/docs/tutorials/adding-electron-fuses/>
- <https://www.electronjs.org/docs/latest/tutorial/application-distribution>
- <https://www.electronjs.org/docs/latest/tutorial/code-signing>
- <https://www.electronjs.org/docs/latest/api/app>
- <https://www.electronjs.org/docs/latest/api/crash-reporter>
- <https://developer.chrome.com/blog/remote-debugging-port>
- <https://github.com/actions/runner-images>
- <https://github.com/rsms/inter>
- <https://github.com/JetBrains/JetBrainsMono>

## 18. Required phase-report field index

This index makes the required 17-field phase-report contract explicit without
rewriting the chronological packaging evidence above.

| Required field | Evidence in this report |
| --- | --- |
| 1. Phase name | Section 1 |
| 2. Completed work | Section 2 |
| 3. Modified files | Section 3 |
| 4. Purpose of each file | Section 4 |
| 5. Dependencies and reason | Section 5 |
| 6. New IPC | No public IPC added; Section 7 |
| 7. New shared types | None; Section 7 |
| 8. New schemas | None; Sections 7-9 reuse existing strict contracts |
| 9. Tests added | Sections 2 and 9 |
| 10. Verification commands | Section 10 |
| 11. Real command results | Section 11 |
| 12. UI files modified | Section 13 |
| 13. Functional necessity | Section 13 |
| 14. Visual regression | Section 14 |
| 15. Remaining mock data | No production mock added; deterministic visual/test fixtures remain test-only |
| 16. Known issues | Sections 15 and 17 |
| 17. Next plan | Section 17 and the Phase 13/completion-audit links |
