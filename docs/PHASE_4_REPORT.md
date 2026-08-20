# Phase 4 Report - Workspaces and Sessions

Date: 2026-08-07

> **Historical snapshot (2026-08-07):** This report preserves the evidence and
> assumptions of Phase 4. It is not current product or release authority. See
> [the documentation index](README.md), [Architecture](ARCHITECTURE.md),
> [Packaging](PACKAGING.md), and [Test Matrix](TEST_MATRIX.md).

## 1. Phase name

Phase 4 - Real local workspaces and per-workspace Pi sessions in the frozen
Sidebar.

## 2. Completed work

- Added a Main-owned, versioned workspace repository under Electron `userData`.
- Persisted canonical path, display name, last-opened time, workspace pin, and
  per-workspace session pins with atomic replacement and mode `0600`.
- Kept canonical paths Main-private. Renderer workspace snapshots contain only
  opaque UUID, name, time, pin, and availability.
- Added native system directory selection and canonical `realpath`, directory,
  read-access, and write-access validation.
- Added corruption backup, unavailable-path recovery, canonical-path
  deduplication, pinned-first recent sorting, and a 100-workspace bound.
- Assigned each workspace an independent Pi JSONL session directory below
  `userData/agent-sessions/<workspace-id>`.
- Added runtime reconfiguration that stops the old Utility Process, changes cwd
  and session root, and starts a higher generation.
- Retained Phase 3 generation, sequence, session ID, and session epoch filters,
  so old workspace/session events cannot update the new selection.
- Added real SessionManager list/new/open/switch/rename/pin/delete/fork actions.
- Required a literal delete confirmation at IPC and created a replacement
  before deleting the active session.
- Required explicit confirmation before workspace, session, new-session, or
  fork replacement while the Agent is running; confirmed replacement aborts
  the active run before rebinding.
- Added a safe synthetic list entry for the current empty Pi session until its
  first JSONL record exists.
- Added a narrow `workspace` preload namespace and session pin support without
  exposing paths, raw IPC, or runtime location inputs.
- Added an Electron workspace adapter/store while preserving the original mock
  state for browser preview and visual tests.
- Wired the existing Sidebar to real current/recent workspaces and sessions,
  including existing title/project search, rename, session pin, delete, and fork
  menu surfaces.
- Reused the existing AlertDialog for deletion, active-run switching, and
  structured operation failure, with both `zh-CN` and `en-US` strings.
- Kept Sidebar width, layout, typography, tokens, and approved normal-state DOM
  pixel-compatible with all frozen references.

## 3. Modified files

- `src/shared/agent-protocol.ts`
- `src/shared/ipc/contracts.ts`
- `src/shared/pipilot-api.ts`
- `src/shared/schemas/workspace.ts`
- `src/agent-worker/index.ts`
- `src/main/agent/agent-runtime-supervisor.ts`
- `src/main/repositories/workspace-repository.ts`
- `src/main/ipc/register-agent-ipc.ts`
- `src/main/ipc/register-workspace-ipc.ts`
- `src/main/index.ts`
- `src/preload/index.ts`
- `src/renderer/adapters/workspace-adapter.ts`
- `src/store/workspace.tsx`
- `src/main.tsx`
- `src/App.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/components/layout/SessionList.tsx`
- `src/components/chat/ChatHeader.tsx`
- `src/data/mock.ts`
- `src/types/chat.ts`
- `src/i18n/locales/en-US.json`
- `src/i18n/locales/zh-CN.json`
- `tests/unit/workspace-repository.test.ts`
- `tests/unit/ipc-contracts.test.ts`
- `tests/electron/pipilot.electron.spec.ts`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/PHASE_4_REPORT.md`

## 4. Purpose of each modified file

| File/group | Purpose |
| --- | --- |
| workspace schema/contracts/API | Strict path-free workspace snapshots, switch/pin results, confirmations, and facade types |
| Agent protocol/worker | Optional fork source handling, session pin view field, and current empty-session listing |
| supervisor/Main repository | Runtime location replacement and private durable workspace/session metadata |
| Main IPC/index | Trusted picker, access checks, per-workspace runtime/session ownership, confirmation, and quit flush |
| preload/adapter/store | Validated workspace events and Electron-vs-web data source split with stale refresh guards |
| App/Sidebar/SessionList/Header | Real Sidebar actions, existing dialogs/menus, current names, and no-workspace behavior |
| mock/types/locales | Deterministic path-free web fixtures and bilingual visible strings |
| tests | Persistence/privacy/contracts and end-to-end workspace/session lifecycle evidence |
| docs | Current ownership, completion status, evidence, limitations, and next phase |

## 5. Dependencies added and reason

None.

Phase 4 uses Electron's existing `dialog`, Node filesystem/path APIs, Zod,
React, the existing Radix AlertDialog/DropdownMenu components, and the Pi SDK
already locked in Phase 3. No Skill, MCP package, browser binary, database,
state library, or filesystem helper dependency was installed. No
`node_modules` file was edited.

## 6. New IPC

| Channel/event | Preload facade | Result |
| --- | --- | --- |
| `pipilot:workspace:get` | `workspace.get()` | Path-free workspace snapshot |
| `pipilot:workspace:choose` | `workspace.choose(confirm)` | Cancelled selection or snapshot plus runtime |
| `pipilot:workspace:open` | `workspace.open(id, confirm)` | Snapshot plus reconfigured runtime |
| `pipilot:workspace:set-pinned` | `workspace.setPinned(id, pinned)` | Updated path-free snapshot |
| `pipilot:workspace:changed` | `workspace.subscribe(listener)` | UUID validated snapshot event |
| `pipilot:session:set-pinned` | `session.setPinned(id, pinned)` | Session pin result |

Existing `session.new`, `session.open`, and `session.fork` requests now include
an explicit active-run confirmation boolean. `session.delete` requires literal
`confirmed: true`; the public preload method likewise requires `true` from the
already-confirmed UI path. All handlers retain trusted-main-frame validation,
UUID correlation, strict request/result schemas, and structured errors.

## 7. New shared types

- `WorkspaceSummary`
- `WorkspaceSnapshot`
- `WorkspaceChooseResult`
- `WorkspaceSwitchResult`
- `WorkspacePinnedResult`
- `SessionPinnedResult`
- Renderer `Workspace`, `RecentProject`, and `WorkspaceStoreValue` fields for
  opaque IDs, time, pin, and availability
- `AgentRuntimeLocation`

No Renderer-facing type contains a local workspace path.

## 8. New runtime schemas

- opaque UUID workspace ID;
- strict workspace summary and revisioned snapshot;
- strict workspace changed event;
- cancelled/non-cancelled native picker result;
- workspace switch result with runtime snapshot;
- workspace/session pin result;
- private version-1 workspace document with bounded recent records and session
  pin map;
- public session new/open/fork confirmation extensions;
- literal delete-confirmation extension.

The private persisted schema is defined only in Main. The public schema rejects
unknown `path` fields.

## 9. Tests added

Four WorkspaceRepository unit tests verify:

- canonical paths persist privately while public snapshots contain no path;
- workspace ordering, owner-only mode, and per-workspace pin persistence;
- restart restoration and current-location resolution;
- missing-path availability recovery and structured rejection;
- corrupt document backup with redacted diagnostic codes.

Two IPC schema tests verify explicit confirmation requirements and rejection of
absolute paths in Renderer-facing snapshots. The suite is now 6 files and 38
tests.

The third Electron E2E case verifies:

- system folder picker selection;
- no path in the Renderer result;
- real Pi prompt/session persistence under workspace-specific roots;
- rename, pin, fork, inactive delete, and active delete with replacement;
- Main rejection of unconfirmed running-session and running-workspace switches;
- confirmed running-workspace replacement and higher runtime generation;
- independent session lists across two workspaces;
- return to a prior workspace with the correct pinned session;
- unavailable recent path handling without window crash;
- application restart restoring current/recent availability and Sidebar data.

## 10. Verification commands

- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm build`
- `pnpm test:electron`
- `pnpm test:visual`
- focused Playwright visual test for the discovered Sidebar difference
- `pnpm peers check`
- `git diff --check`
- focused trailing-whitespace and path-exposure searches
- Git index mode and local Skill symlink ignore inspection

## 11. Real result of each command

### TypeScript, unit tests, and build

- `pnpm typecheck`: passed without diagnostics after the implementation batch.
- First unit run: 37 passed and one test failed because macOS canonicalized
  a temporary directory path; the assertion was corrected to compare the
  repository-returned canonical path.
- Final `pnpm test:unit`: 6 files passed, 38 tests passed, 301 ms.
- Final `pnpm build`: passed. Main transformed 22 modules; shared protocol
  chunk 10.99 kB, Agent Worker 22.93 kB, Main 75.73 kB. Preload transformed 85
  modules and emitted 168.08 kB. Renderer transformed 643 modules and emitted
  HTML 1.56 kB, CSS 94.92 kB, and JS 1,949.80 kB.

### Electron integration

- First Phase 4 run: existing two tests passed; the new case found that Pi does
  not list a current empty session before its first JSONL write.
- Worker list behavior was corrected with a bounded current-session entry.
- Second run proved that fix and found only an invalid test expectation after
  deleting every persisted A-session; the test now sends a prompt through the
  replacement before asserting disk persistence.
- Final `pnpm test:electron`: 3 passed, 0 failed, 13.2 seconds in the approved
  desktop environment.

### Visual regression

- First full comparison detected the same 603-605 changed pixels in all stable
  screenshots after conditional unavailable/pin DOM was added to recent rows.
- The recent-row normal DOM was restored; a focused dark/idle comparison then
  passed.
- Final `pnpm test:visual`: 8 passed, 0 failed, 12.0 seconds.
- No screenshot baseline was updated.

### Repository checks

- `pnpm peers check`: no peer dependency issues.
- Final `git diff --check`: passed.
- Focused trailing-whitespace search returned no match.
- Git index contains zero mode-120000 entries. Local Skill links remain ignored
  and are not staged.

## 12. UI files modified

- `src/App.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/components/layout/SessionList.tsx`
- `src/components/chat/ChatHeader.tsx`
- `src/main.tsx`
- `src/store/workspace.tsx`
- `src/data/mock.ts`
- `src/types/chat.ts`
- both locale catalogs

## 13. UI modification necessity

UI wiring was required because this phase explicitly replaces Sidebar project
and session fixtures. The existing three-column composition, Sidebar width,
sections, controls, typography, spacing, colors, tokens, and normal-state
recent-project/session layout were retained. New actions use the existing
session dropdown and AlertDialog primitives; no new panel or permanent row was
added.

本阶段只把冻结 Sidebar 的数据源和既有操作接到真实工作区/会话，并复用现有菜单与确认框；未修改布局、宽度、主题 Token、字号或基线视觉。

## 14. Visual regression result

Passed: 8 of 8 approved macOS references after restoring the exact normal-state
recent-row DOM. No baseline file changed.

## 15. Mock data still in use

- Browser preview and visual tests intentionally use the original deterministic
  workspace/session fixtures.
- Electron MessageList, user/Agent messages, thinking, tools, approval state,
  Composer prompt submission, and context usage remain mock until Phase 5.
- Inspector Files/Diff/Terminal/Logs remain mock.
- visible model selection/provider state remains mock.
- General settings beyond the Phase 2 locale/appearance surface remain mock.

Electron current/recent workspaces and Sidebar sessions are real in this phase.

## 16. Known issues

- The message area still shows the Phase 0 conversation while Sidebar selection
  is real; Phase 5 replaces that data and unifies visible runtime status.
- Empty current sessions are viewable immediately but Pi only persists them
  after the first session record/message, which is expected SDK behavior.
- A repository update reports a bounded diagnostic if an asynchronous atomic
  write fails; the current in-memory value remains until shutdown flush or
  restart.
- Runtime reconfiguration is not rolled back to the old workspace if the new
  worker itself fails to start. The new workspace remains selected with a
  structured failed runtime that can be retried.
- The existing Phase 3 provider-auth, headless extension UI, permission/tool,
  resource rollback, packaging, font, fuse, and signing limitations remain.

## 17. Next phase plan

Phase 5 will replace visible conversation fixtures without changing the frozen
message composition:

1. add a per-workspace/session normalized message store keyed by session and
   message IDs;
2. load persisted Pi session messages through a safe Worker operation;
3. submit Composer prompts to the real session and handle steer/follow-up;
4. reduce text/thinking/lifecycle events with batched streaming publication;
5. preserve Markdown safety, code rendering, copy/wrap/scroll behavior, and
   bottom-follow semantics;
6. clear stale buffers on session/workspace replacement and represent Abort,
   errors, retry, and compaction truthfully;
7. verify malformed Markdown, rapid streaming, cross-session isolation,
   Electron E2E, performance, and all frozen visual references.

## Completion audit addendum - 2026-08-08

The earlier workspace-pin interaction gap is resolved. Each recent-project row
now exposes a localized pin/unpin icon button without nesting interactive
controls. Unpinned controls remain hidden until hover or keyboard focus; pinned
controls remain visible. The existing `workspace.setPinned()` contract and
Main-owned repository remain unchanged.

The final workspace Electron scenario uses the visible control, verifies
pinned-first persistence across restart, opens a prior workspace through its
localized project-specific button, and unpins it after restart. The complete
Electron suite passed 9/9 and the comparison-only visual suite passed 10/10
without changing a baseline.
