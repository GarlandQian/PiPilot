# Phase 6 Report - Tool Lifecycle and Permissions

Date: 2026-08-07

> **Historical snapshot (2026-08-07):** This report preserves the evidence and
> assumptions of Phase 6. It is not current product or release authority. See
> [the documentation index](README.md), [Architecture](ARCHITECTURE.md),
> [Packaging](PACKAGING.md), and [Test Matrix](TEST_MATRIX.md).

## 1. Phase name

Phase 6 - Mandatory Pi tool authorization, exact permission scopes, and
truthful tool/approval lifecycle in the frozen conversation surface.

## 2. Completed work

- Inspected the installed and locked Pi Coding Agent 0.84.0 declarations and
  bundled implementation for built-in tool inputs/results, session events,
  inline-extension ordering, awaited `tool_call` blocking, `tool_result`
  replacement, abort signals, custom entries, and faux-provider tool calls.
- Enabled Pi's Read, Bash, Edit, Write, Grep, Find, and Ls tools only after
  installing a hidden PiPilot authorization extension in the Agent Utility
  Process. Git, test, and extension capabilities flow through Bash/custom tool
  classification rather than a renderer bypass.
- Added canonical workspace checks for file tools, including traversal,
  existing-ancestor symlink escape, and known credential/sensitive-file denial.
- Added a private Worker-to-Main permission request containing only a bounded
  operation descriptor, canonical relative path or exact command, and argument
  fingerprint.
- Added Main-owned `PermissionService` policy for read, write, shell, network,
  destructive, and custom operations.
- Added one-shot, exact-session, exact-workspace, and exact-global rules.
  Session rules remain in memory; workspace/global rules are atomically stored
  in owner-only `userData/permissions.json` and capped at 1,000 entries.
- Added exact SHA-256 matchers for complete Bash commands, file operation plus
  canonical relative target, and custom tool name plus canonical argument
  fingerprint. Prefix/glob grants are not used.
- Added conservative high-risk recognition for destructive/compound shell,
  overwrite/redirection, privilege and destructive utilities, global package
  operations, publish/deploy/release, Git history rewrite, force push, branch
  deletion, and workspace-external mutation signals.
- Restricted high-risk grants to the active session. Medium-risk exact rules
  expose session/workspace/all-workspace choices only after the existing
  ApprovalCard's second confirmation.
- Bound every request and resolution to runtime generation, session epoch,
  session ID, workspace ID, approval ID, and tool-call ID. Wrong-session,
  expired, duplicate, stale, or unavailable-scope decisions are rejected.
- Cancelled pending approvals on Abort, session replacement, runtime stop,
  runtime failure, Worker cancellation, or five-minute expiry.
- Added path-free public approval events and narrow `permissions.pending()`,
  `permissions.resolve()`, and `permissions.subscribe()` preload APIs. Renderer
  requests a decision but never makes the final authorization decision.
- Added queued, waiting-approval, running, success, failed, and cancelled tool
  reduction keyed by tool-call ID and session ID. Waiting approval replaces the
  global running status rather than coexisting with it.
- Added real duration, command/path presentation, bounded text output, unified
  patch, and added/deleted line counts to existing ToolCallCard data.
- Sanitized tool result content before Pi session persistence; removed Bash
  full-output paths, redacted workspace/home paths and secret-shaped values,
  bounded visible data, and projected only PiPilot-authored safe metadata.
- Persisted manual approval decisions and safe tool metadata as namespaced Pi
  custom entries. Preflight-denied tools get an explicit cancelled entry even
  though Pi does not invoke `tool_result` after a preflight block.
- Added the required dependency-install impact to real ApprovalCards with
  matching `zh-CN` and `en-US` text while retaining the approved browser-fixture
  DOM and all existing visual baselines.

## 3. Modified files

- `src/shared/permissions.ts`
- `src/shared/agent-protocol.ts`
- `src/shared/ipc/contracts.ts`
- `src/shared/pipilot-api.ts`
- `src/main/permissions/permission-policy.ts`
- `src/main/permissions/permission-repository.ts`
- `src/main/permissions/permission-service.ts`
- `src/main/agent/agent-runtime-supervisor.ts`
- `src/main/ipc/register-agent-ipc.ts`
- `src/main/index.ts`
- `src/agent-worker/permission-gate.ts`
- `src/agent-worker/index.ts`
- `src/agent-worker/transcript.ts`
- `src/preload/index.ts`
- `src/renderer/adapters/message-adapter.ts`
- `src/store/message-reducer.ts`
- `src/store/messages.tsx`
- `src/App.tsx`
- `src/components/chat/ApprovalCard.tsx`
- `src/components/chat/ToolCallCard.tsx`
- `src/components/chat/MessageList.tsx`
- `src/types/chat.ts`
- `src/data/mock.ts`
- `src/i18n/locales/en-US.json`
- `src/i18n/locales/zh-CN.json`
- `tests/unit/permission-repository.test.ts`
- `tests/unit/permission-service.test.ts`
- `tests/unit/agent-protocol.test.ts`
- `tests/unit/ipc-contracts.test.ts`
- `tests/unit/message-reducer.test.ts`
- `tests/unit/transcript-projection.test.ts`
- `tests/electron/pipilot.electron.spec.ts`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/PHASE_6_REPORT.md`

## 4. Purpose of each modified file

| File/group | Purpose |
| --- | --- |
| shared permission/protocol/contracts/API | Strict private descriptors, path-free public requests, decision/lifecycle types, Worker messages, IPC channels, and narrow facade |
| Main permission policy/repository/service | Risk analysis, redaction, exact matching, pending/session ownership, atomic persistent rules, expiry, and cancellation |
| supervisor/Main IPC/app entry | Private Worker routing, active context validation, Renderer events/handlers, lifecycle cleanup, and user-data initialization |
| Worker permission gate/runtime/transcript | Mandatory Pi hooks, canonical path defense, preflight blocking, safe result replacement, metadata persistence, enabled tools, and safe history projection |
| preload/adapter/store/reducer | Validated permission delivery, buffered startup reconciliation, real decisions, tool/approval normalization, and status isolation |
| existing chat components/types | Render real presentation, duration, output, patch, risk, impact, and exact-scope choices without visual redesign |
| locale catalogs/mock fixture | Bilingual real-only permission text and type-compatible unchanged browser reference fixture |
| unit/Electron tests | Repository, matching, policy, redaction, protocol, reducer, persistence, cross-session, real tool, and no-unapproved-side-effect evidence |
| docs | Implemented architecture, completion state, exact verification, limitations, and Phase 7 handoff |

## 5. Dependencies added and reason

None.

Pi 0.84.0 extension hooks, Node crypto/fs/path APIs, Zod, the existing Electron
bridge, React store, Vitest, and Playwright cover the phase. No dependency,
Skill, MCP package, browser binary, or package version was installed or
updated, and no `node_modules` file was modified.

The repository Playwright dependency remains necessary for checked-in Electron
and visual test execution. A Playwright MCP controls a browser session but does
not replace the project's test runner, assertions, configs, or CI dependency.

## 6. New IPC

| Channel | Preload facade | Result |
| --- | --- | --- |
| `pipilot:permission:pending` | `permissions.pending()` | Pending path-free requests for the active workspace/session |
| `pipilot:permission:resolve` | `permissions.resolve(...)` | Validated recorded decision after Main authorization |
| `pipilot:permission:changed` | `permissions.subscribe(...)` | Pending/approved/denied/cancelled/expired public lifecycle event |

Private Worker messages `permission-request` and `permission-cancelled`, plus
the correlated Worker operation `permission.resolve`, never pass through the
Renderer. No raw `ipcRenderer`, generic invoke/send, filesystem, command, or
Pi SDK escape hatch was added.

## 7. New shared types

- `PermissionOperation`
- `PermissionCategory`
- `PermissionRisk`
- `PermissionPersistentScope`
- `PermissionDecision`
- `PermissionStatus`
- `PermissionImpact`
- `PermissionToolDescriptor` (private)
- `PermissionRequest` (public, path-free)
- `PermissionChangedEvent`
- `PermissionPendingSnapshot`
- `PermissionResolution`
- `ToolPresentation`
- private Worker permission request/cancellation messages
- approval transcript item and extended tool transcript fields

## 8. New runtime schemas

- operation/category/risk/scope/decision/status enums;
- bounded tool presentation and 64-character SHA-256 descriptor fingerprint;
- strict path-free public request with risk, purpose, six impact booleans,
  allowed scopes, creation time, and expiry;
- strict changed event, pending snapshot, and non-pending resolution;
- versioned strict permission-rule document with workspace/global invariants;
- private Worker request/cancellation envelopes bound to runtime/session epoch;
- `permission.resolve` Worker operation and Renderer IPC contracts;
- extended strict Agent tool events and transcript tool/approval items.

Unknown fields are rejected at Worker, Main, preload, and Renderer-facing
schema boundaries.

## 9. Tests added

Unit coverage now proves:

- owner-only atomic rule persistence, de-duplication, restart restoration, and
  corrupt-document backup;
- safe workspace reads auto-authorize without a public prompt;
- one-shot grants do not match a second tool call;
- session rules match only the exact operation and session;
- workspace rules do not cross workspaces, while exact all-workspace rules do;
- wrong-session and expired decisions cannot authorize execution;
- high-risk rules expose session scope only;
- Git force/history/branch, global package, external-write, dependency install,
  network, file-mutation, and secret/path-redaction behavior;
- strict private Worker and public IPC permission envelopes;
- waiting-approval, approved, denied, cancelled, output, duration, patch, and
  diff reducer transitions;
- persisted projection trusts only sanitized PiPilot metadata and omits raw Pi
  tool arguments/results.

Electron E2E additionally proves:

- the sandbox bridge exposes a narrow `permissions` business API;
- a real Pi Bash tool cannot create its target file while approval is pending;
- a wrong-session decision is rejected and leaves the request pending;
- denial leaves the target absent and persists cancelled tool state;
- one-shot allow executes the exact Bash call and produces the expected file;
- public requests/events omit the canonical temporary workspace path;
- a real Pi Read auto-authorizes, returns actual bounded content, and records
  success/duration/presentation;
- a real Pi Edit does not mutate before approval, then writes the expected
  content and records its actual unified patch and line counts;
- medium-risk Edit exposes the second-confirmation session/workspace/global
  exact-rule choices before any choice takes effect;
- waiting approval is visible while the running label is absent.

## 10. Verification commands

- installed Pi 0.84.0 `.d.ts` and bundled-source inspection;
- attempted official upstream search, followed by installed/locked fallback;
- bundled offline pnpm 11.16.0 `typecheck`;
- bundled offline pnpm 11.16.0 `test:unit`;
- `./node_modules/.bin/electron-vite build`;
- focused and full Playwright Electron runs with the Electron config;
- comparison-only Playwright visual suite;
- bundled offline pnpm 11.16.0 `peers check`;
- `git diff --check`;
- focused secret/path, generated-artifact, lockfile, and Git-index hygiene checks.

## 11. Real result of each command

### API inspection, TypeScript, and unit tests

- Official upstream search returned HTTP 503 (`auth_not_found`), so no search
  summary was treated as authority. Installed/locked Pi 0.84.0 declarations and
  bundled source were used instead.
- Inspection confirmed built-in Read/Bash/Edit/Write/Grep/Find/Ls definitions,
  `tool_execution_*` events, awaited/mutable `tool_call`, replaceable
  `tool_result`, `ExtensionContext.signal`, `ExtensionAPI.appendEntry`, inline
  extension factories, and faux tool calls.
- Final TypeScript: `tsc --noEmit` passed.
- Final unit suite: 10 files passed, 66 tests passed, 519 ms.

### Build and dependency checks

- Bare Corepack `pnpm` still attempts an unavailable `pnpm/latest` registry
  lookup. The preinstalled offline pnpm 11.16.0 binary ran project scripts.
- Equivalent verified build steps, separate successful typecheck plus
  `./node_modules/.bin/electron-vite build`, passed.
- Main transformed 28 modules and emitted protocol chunk 18.35 kB, Agent Worker
  49.42 kB, and Main 102.40 kB.
- Preload transformed 86 modules and emitted 176.82 kB.
- Renderer transformed 646 modules and emitted HTML 1.56 kB, CSS 94.92 kB, and
  JS 1,990.67 kB.
- `pnpm peers check`: no peer dependency issues.

### Electron integration and visual regression

- The first focused Shell E2E confirmed the denied command did not execute but
  exposed that Pi skips `tool_result` after preflight blocking. Denied history
  initially appeared as failed. The gate now writes a sanitized cancelled
  metadata entry on every preflight block; the focused rerun passed.
- The first visual run showed identical 697/735-pixel differences in all six
  main references after adding the dependency-install row to the browser mock.
  The required field now renders only for real permission requests; no baseline
  was changed, and the final comparison passed all 8 references in 12.8 s.
- Final Electron E2E: 5 passed, 0 failed, 18.2 s. It exercised sandbox startup,
  Pi session/crash recovery, Shell deny/allow, Read/Edit lifecycle, workspace
  isolation, and persisted sessions.
- No visual baseline file was updated.

### Repository checks

- `git diff --check` passed with no whitespace errors.
- Focused source/test scans found no real home/workspace path, API-key-shaped
  value, or private-key marker in the Phase 6 runtime surface.
- `git diff --name-only -- tests/visual/__screenshots__` returned no changed
  visual baseline files.
- No generated Playwright result/report directory surfaced as a new Git item;
  the two existing tracked `.playwright-mcp` log deletions were pre-existing
  worktree state and remain untouched.
- The Git index contains no mode `120000` entry. Tracked `.agents/skills`
  entries remain mode `100644`; their machine-local replacement-link deletion
  noise is not staged.
- Machine-specific `.agents/skills` replacement links and their tracked
  deletion noise remain unstaged and untouched.

## 12. UI files modified

- `src/App.tsx`
- `src/components/chat/ApprovalCard.tsx`
- `src/components/chat/ToolCallCard.tsx`
- `src/components/chat/MessageList.tsx`
- `src/store/messages.tsx`
- `src/store/message-reducer.ts`
- `src/types/chat.ts`
- `src/data/mock.ts`
- both locale catalogs

No CSS, theme token, typography, spacing, radius, border, card structure, or
visual baseline file was modified.

## 13. UI modification necessity

Phase 6 explicitly requires the frozen ToolCallCard and ApprovalCard to show
real tool and permission state. Their data props and existing content regions
therefore needed duration/output/patch fields, risk and impact values, and
scope decision actions. The persistent-scope choice reuses the card's existing
second-confirmation box. The dependency-install row is shown only for strict
real permission requests, and the browser fixture keeps the approved DOM.

本阶段只把真实工具生命周期、风险、影响、审批范围和结果接入现有卡片；未修改三栏布局、主题 Token、CSS、字号、间距、圆角、边框、信息密度、Markdown 样式或组件视觉结构。

## 14. Visual regression result

Passed: all 8 approved macOS dark/light references. No baseline was regenerated
or modified. The one intentional real-only impact row is excluded from browser
fixture references and is verified in Electron E2E.

## 15. Mock data still in use

- Browser preview and visual tests intentionally retain the approved complete
  conversation/tool/approval fixture.
- Inspector Files/Diff remain mock until Phase 7.
- Terminal and Logs remain mock until Phase 8.
- Header model/provider/context usage and Provider settings remain scheduled
  for Phase 9.
- Resource/MCP settings and diagnostics remain scheduled for Phase 10.
- Electron E2E uses Pi's actual session/runtime/tool implementations with its
  official faux model provider; production mode uses the user's configured
  real Provider.

Electron tool hooks, policy, approvals, exact rules, Read/Edit/Bash execution,
duration/output/patch projection, cancellation, and persistence are real.

## 16. Known issues

- Shell classification is intentionally conservative and exact-command based;
  it is not a full shell parser. Compound commands are treated as high risk and
  cannot receive workspace/global rules.
- Saved rules have no real settings management surface yet. They are created
  only through approval, stored safely in Main, and bounded to 1,000; a later
  resource/settings phase must expose reviewed listing/removal without
  broadening matchers.
- Tool text is capped at 200,000 characters and transcript history keeps the
  Phase 5 item/total bounds. Full binary output and Pi temporary output files
  are deliberately not exposed to Renderer.
- The permission gate blocks known credential paths even for read; there is no
  Renderer override for these sensitive files.
- Phase 7 will consolidate canonical workspace path operations for Files/Diff
  instead of exposing this Worker-local helper to Renderer.
- Existing Provider authentication, resource diagnostics, terminal, packaging,
  fuse, signing, notarization, and release limitations remain assigned to their
  ordered later phases.
- Bare Corepack pnpm remains unusable without registry access in this sandbox;
  verification used the bundled offline executable without changing packages.

## 17. Next phase plan

Phase 7 will connect the frozen Files and Diff inspector surfaces:

1. introduce a Main-owned canonical workspace path service shared by file
   listing, preview, diff, accept, and rollback;
2. add lazy directory expansion with generated/cache ignore defaults and Git-
   absent fallback status;
3. add bounded text preview and explicit binary/large-file outcomes;
4. project actual unified modifications into the existing DiffViewer;
5. add accept/rollback with content identity and external-change conflict
   guards;
6. prove traversal and symlink escape rejection, large-tree bounds, truthful
   diff, conflict refusal, Electron workflow, and unchanged visual references.
