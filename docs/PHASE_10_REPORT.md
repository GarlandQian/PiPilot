# Phase 10 Report - Skills, Extensions, MCP, and Resources

Date: 2026-08-08

> **Historical snapshot (2026-08-08):** This report preserves the evidence and
> assumptions of Phase 10. It is not current product or release authority. See
> [the documentation index](README.md), [Architecture](ARCHITECTURE.md),
> [Packaging](PACKAGING.md), and [Test Matrix](TEST_MATRIX.md).

## 1. Phase name

Phase 10 - Real Pi resource discovery, diagnostics, enable configuration, and
transactional runtime reload.

## 2. Completed work

- Inspected the installed `@earendil-works/pi-coding-agent` 0.84.0 public
  declarations and distribution source for `DefaultResourceLoader`,
  `DefaultPackageManager`, `SettingsManager`, resource metadata, diagnostics,
  extension commands, session prompt routing, and runtime reload behavior.
- Built resource discovery from the actual Pi loaders and exposed Skills,
  extensions, prompt templates, context files, extension-provided MCP bridges,
  commands, compatible memory extensions, and redacted diagnostics.
- Classified every resource as global, project, package, or custom and kept
  canonical/absolute paths, resource contents, raw errors, tokens, and stack
  traces out of shared schemas, preload, and Renderer state.
- Exposed Skill name, description, source, enabled state, and diagnostic count;
  extension name, source, loaded/error state; MCP scope, enabled state, and
  capability risk; and summary counts through strict bounded schemas.
- Made malformed individual Skills/extensions nonfatal. Initial discovery-wide
  failure produces a safe empty snapshot with a code-only diagnostic instead
  of crashing the main window.
- Implemented candidate-session resource reload. The old Pi session/runtime is
  retained until the candidate has loaded successfully, then atomically
  replaced; failed discovery or construction disposes only the candidate.
- Added a Main-owned atomic, owner-only resource-preference repository. Enable
  changes are serialized and compensated on candidate failure so persistence,
  UI state, and the active runtime cannot diverge.
- Bound project discovery to the active canonical workspace. Worker restart on
  workspace switch updates project resources while the existing generation and
  session identity rules reject stale events.
- Forwarded extension commands through Pi's normal `AgentSession.prompt`
  command path. Observational Memory and Hermes Memory are detected as
  compatible installed extensions; neither memory implementation is
  duplicated.
- Represented MCP truthfully as extension/package bridges because installed Pi
  0.84.0 has no native MCP subsystem. MCP bridges default disabled and are
  marked for filesystem write, shell, database write, deploy, and repository
  administration risk before explicit enable confirmation.
- Prevented implicit package installation. Missing package references become a
  diagnostic (or make an explicit transactional reload fail), and the worker's
  read-only runtime settings view strips package declarations before secondary
  Pi loaders can resolve/install them again.
- Added resource list, reload, and explicitly confirmed enable operations to
  the narrow preload facade and connected them to the existing Agent settings
  destination without changing frozen layout or visual tokens.
- Added every new visible string to both `zh-CN` and `en-US` catalogs.

## 3. Modified files

- `src/shared/resources.ts`
- `src/shared/agent-protocol.ts`
- `src/shared/ipc/contracts.ts`
- `src/shared/pipilot-api.ts`
- `src/main/repositories/resource-preference-repository.ts`
- `src/main/agent/agent-runtime-supervisor.ts`
- `src/main/ipc/register-agent-ipc.ts`
- `src/main/index.ts`
- `src/preload/index.ts`
- `src/agent-worker/resource-catalog.ts`
- `src/agent-worker/index.ts`
- `src/store/resources.tsx`
- `src/main.tsx`
- `src/components/settings/ResourcesSettings.tsx`
- `src/components/settings/SettingsLayout.tsx`
- `src/i18n/locales/en-US.json`
- `src/i18n/locales/zh-CN.json`
- `tests/unit/resource-preference-repository.test.ts`
- `tests/unit/resource-catalog.test.ts`
- `tests/unit/agent-protocol.test.ts`
- `tests/unit/ipc-contracts.test.ts`
- `tests/electron/pipilot.electron.spec.ts`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/PHASE_10_REPORT.md`

## 4. Purpose of each modified file

| File/group | Purpose |
| --- | --- |
| shared resource/protocol/contracts/API | Bounded path-free resource domain, private worker operations, named IPC, and narrow facade |
| Main preference repository/IPC/supervisor | Atomic enable state, serialized compensation, trusted sender validation, and startup preference injection |
| Agent worker/catalog | Actual Pi discovery, sanitization, risk/source classification, command forwarding metadata, missing-package guard, and candidate runtime swap |
| resource store/provider | Generation-aware Electron state, safe browser fixture, explicit reload, and response-after-success updates |
| Settings resource UI | Existing Agent destination connected to summaries, resource status, diagnostics, risk confirmation, and memory compatibility |
| locale catalogs | Complete bilingual resource labels, states, risks, confirmations, diagnostics, and failures |
| unit/Electron tests | Schema boundaries, persistence, partial failure, risk detection, safe package handling, rollback, workspace switching, restart, and command evidence |
| docs | Implemented architecture, completion state, exact verification, limitations, and Phase 11 handoff |

## 5. Dependencies added and reason

None.

The installed Pi 0.84.0 packages, Zod, React, existing Radix/shadcn primitives,
React Icons, Vitest, and repository Playwright already cover the required
behavior. Playwright MCP remains useful for interactive inspection but does not
replace the checked-in Playwright dependency, repeatable Electron/visual test
configuration, or CI runner. No browser binary, MCP server, package resource,
or Codex/agent Skill was installed.

## 6. New IPC

| Channel | Preload facade | Result |
| --- | --- | --- |
| `pipilot:resources:list` | `resources.list()` | Current bounded resource snapshot |
| `pipilot:resources:reload` | `resources.reload()` | Snapshot from a successfully swapped candidate runtime |
| `pipilot:resources:set-enabled` | `resources.setEnabled(resourceId, enabled, true)` | Confirmed preference and transactional runtime result |

The private Agent protocol additionally carries startup resource preferences
and `resources.list`, `resources.reload`, and `resources.configure` operations.
It remains a versioned business protocol rather than a generic transport.

No raw `ipcRenderer`, generic invoke/send, resource path/content, Pi loader,
runtime object, extension error body, package installer, token, or settings
storage primitive is exposed through preload.

## 7. New shared types

- `ResourceId`, `ResourceSource`, `ResourceScope`, and `ResourceKind`
- `ResourceSkill`, `ResourceExtension`, `ResourcePromptTemplate`, and
  `ResourceContextFile`
- `ResourceMcpServer`, `ResourceMcpRisk`, and `ResourceCommand`
- `ResourceDiagnostic`, `ResourceMemoryCompatibility`, and `ResourceSummary`
- `ResourceSnapshot` and `ResourcePreference`
- internal runtime resource plan and sanitized Pi diagnostic projections

## 8. New runtime schemas

- opaque `resource_<64 hex>` identifiers and bounded names/descriptions;
- exact global/project/package/custom source and global/project scope enums;
- strict Skill/extension/prompt/context/MCP/command/memory projections;
- explicit MCP risk enum for filesystem write, shell, database write, deploy,
  and repository administration;
- bounded code-only diagnostics with severity and optional opaque resource ID;
- summary counts constrained to the corresponding array lengths;
- strict list/reload/configure worker operations and startup preferences;
- explicit literal-true confirmation for resource enable state mutation;
- strict snapshots that reject paths, contents, tokens, raw error objects, and
  unknown fields.

## 9. Tests added or changed

Unit coverage proves:

- resource schemas reject paths, tokens, unknown fields, and unconfirmed
  mutation requests;
- all five required high-permission capability categories are detected;
- real Pi global and project Skills, prompts, context files, and extensions are
  classified correctly;
- one malformed Skill contributes a warning without making startup fatal;
- MCP extension bridges default disabled and become enabled only from an
  explicit persisted preference;
- a configured missing package is diagnosed and skipped on initial startup,
  never implicitly installed, while strict transactional discovery rejects it;
- resource preferences persist only opaque IDs/state with mode `0600`, recover
  malformed JSON through backup, serialize concurrent updates, and restore the
  exact prior document on compensation;
- Agent protocol and IPC accept the expanded path-free snapshots and reject
  malformed or unconfirmed operations.

Electron E2E additionally proves:

- global and project resources render in the existing Agent settings view;
- broken Skill and extension fixtures do not crash startup;
- Observational Memory and Hermes Memory are both discovered disabled, enabled
  through explicit resource preferences, loaded by Pi, and invoked through
  Pi's normal extension-command forwarding path;
- an MCP bridge exposes all five risks, defaults disabled, requires explicit
  confirmation, and persists no token or project configuration change;
- restart restores the enabled preference and resource commands;
- a deliberately missing package makes candidate reload/configure fail without
  installation, while the old working runtime and snapshot remain active;
- failed enable configuration restores the exact previous preference file;
- switching from workspace A to B replaces project resources and removes the
  old project's resource view.

## 10. Verification commands

- installed Pi package declaration/source inspection for resource loader,
  package manager, settings storage, extension commands, and reload behavior;
- bundled offline pnpm focused Phase 10 Vitest runs;
- bundled offline pnpm `run test:unit`;
- bundled offline pnpm `run build`;
- focused and complete Playwright Electron runs;
- comparison-only bundled offline pnpm `run test:visual`;
- bundled offline pnpm `peers check`;
- locale-key parity script;
- `git diff --check`, staged-diff, visual-baseline, ignored-artifact, and local
  Skill symlink hygiene checks.

## 11. Real result of each command

### Pi inspection and focused verification

- Pi packages are fixed at 0.84.0. Public source confirms
  `DefaultResourceLoader` aggregates configured and explicit resources,
  `DefaultPackageManager.resolve` can request installation of missing packages,
  and session prompt routing executes registered extension commands.
- Pi 0.84.0 explicitly has no native MCP subsystem. The implemented MCP view is
  therefore limited to resources that identify as extension/package bridges.
- An early missing-package test timed out because an inventory loader created a
  second package manager and reached Pi's implicit installation path. After the
  runtime settings storage was made read-only and package declarations were
  stripped from secondary loaders, the affected resource-catalog test passed 2
  tests in 557 ms with no lingering process.
- The final focused resource Electron scenario passed 1 test in 5.3 s after the
  safe package-resolution change.

### TypeScript, unit tests, and build

- Final production build ran its own `tsc --noEmit`; both passed.
- Final unit suite passed 16 files and 110 tests in 915 ms.
- Production build transformed 41 Main modules and emitted protocol 25.20 kB,
  Agent Worker 78.87 kB, and Main 192.80 kB.
- Preload transformed 90 modules and emitted 196.67 kB.
- Renderer transformed 737 modules and emitted HTML 1.56 kB, initial CSS
  96.52 kB, initial JavaScript 2,077.98 kB, and unchanged lazy Terminal chunks
  of CSS 7.11 kB and JavaScript 568.98 kB.
- Locale parity passed with exactly 455 keys in each catalog.
- `pnpm peers check`: no peer dependency issues.

### Electron integration and visual regression

- The complete Electron suite passed all 9 tests in 34.7 s before the final
  missing-package guard. The narrower affected resource scenario then passed
  after both the preference-compensation assertion and final guard, as recorded
  above; per repository policy, unaffected passing scenarios were not rerun.
- Final visual comparison passed all 8 approved macOS dark/light references in
  13.1 s. No baseline was regenerated or modified by the command.

### Repository checks

- `git diff --check` passed with no whitespace errors. The new report and
  touched documentation also have no trailing whitespace.
- The locale catalogs have no missing key on either side.
- No tracked visual baseline diff was produced and the normal visual command
  remained comparison-only.
- The staged diff is empty. Every indexed `.agents/skills` entry remains the
  historical regular-file mode `100644`; the index contains no mode `120000`.
- Machine-local `.agents/skills` symlink replacement/deletion noise remains
  unstaged and untouched, as requested.
- Playwright result/report directories remain ignored and are not delivery
  source files.

## 12. UI files modified

- `src/components/settings/ResourcesSettings.tsx`
- `src/components/settings/SettingsLayout.tsx`
- `src/store/resources.tsx`
- `src/main.tsx`
- both locale catalogs

No theme token, global CSS, three-column geometry, title/body/code scale, spacing,
radius, border, density, Markdown styling, ApprovalCard, ToolCallCard, or visual
baseline file was changed.

## 13. UI modification necessity

Phase 10 explicitly requires resources and diagnostics to be visible and
manageable. `ResourcesSettings` replaces only the prior Agent placeholder
inside the existing Settings destination. It reuses existing setting sections,
rows, badges, switches, buttons, tooltips, and confirmation dialogs. Risky MCP
enablement requires confirmation because it changes the active Pi runtime.

本阶段只把真实资源目录、加载状态、诊断、风险和启用配置接入既有 Agent 设置区域；未重做三栏布局，也未修改主题 Token、字号、间距、圆角、边框、Markdown 或卡片结构。

## 14. Visual regression result

Passed: all 8 approved macOS dark/light references. The deterministic browser
fixture keeps the existing Appearance settings screenshot independent of
Electron-only resource discovery. No baseline was regenerated or modified.

## 15. Mock data still in use

- Browser preview and visual tests intentionally expose a deterministic empty
  resource snapshot because Pi runs only in the Electron Utility Process.
- Electron tests use real Pi loaders and sessions with temporary global/project
  resources and deterministic local extensions.
- MCP status is based on installed extension/package bridge metadata; there is
  no fake native Pi MCP registry.
- Inspector Logs remain a static/empty surface until Phase 11 completes the
  relevant deterministic lifecycle and failure test matrix.

## 16. Known issues

- Pi 0.84.0 has no native MCP subsystem. Generic protocol-level MCP server
  connection, auth, tool enumeration, and transport health cannot be claimed;
  only installed Pi extension/package bridges are represented.
- Resource changes require an idle Agent runtime and explicit reload/enable or
  workspace/runtime transition. File watching is not added.
- Missing packages are deliberately never installed by PiPilot. The settings UI
  has no package-install flow because dependency acquisition and high-permission
  server installation need a separately authorized product capability.
- Memory compatibility depends on installed extension identity and commands;
  PiPilot does not inspect or expose private memory storage.
- Diagnostics are code-only and redacted, so detailed upstream parse locations
  remain available only inside Pi's own local tooling rather than Renderer.
- Package signing, hardened runtime, installers, and cross-platform packaged
  behavior remain Phase 12 work.
- Bare Corepack pnpm remains unusable without registry access in this sandbox;
  verification used the bundled pnpm executable and existing lockfile.

The final completion-audit Electron run exercised both deterministic memory
extension fixtures together and passed as part of the complete 9/9 suite.

## 17. Next phase plan

Phase 11 will complete and consolidate the test/CI matrix:

1. inventory existing unit, integration, Electron, visual, and security evidence
   against every listed acceptance item before adding any test;
2. add only missing stable contract and workflow coverage, reusing Vitest and
   the existing Playwright Electron/visual harnesses;
3. cover Main/preload and Main/worker boundaries, session replacement and event
   rebinding, persistence/crash recovery, filesystem/permission/PTY/credential
   isolation, and deterministic child-process cleanup;
4. exercise the complete Electron workflow including prompt streaming, tool
   approval allow/deny, inspector destinations, settings, theme, and locale;
5. add deterministic failed-state visual evidence if it is absent without
   regenerating approved baselines automatically;
6. define CI gates for typecheck, unit/integration, build, Electron E2E, and
   comparison-only visual regression with no baseline-update script.
