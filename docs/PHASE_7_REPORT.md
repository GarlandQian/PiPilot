# Phase 7 Report - Files and Diff

Date: 2026-08-08

> **Historical snapshot (2026-08-08):** This report preserves the evidence and
> assumptions of Phase 7. It is not current product or release authority. See
> [the documentation index](README.md), [Architecture](ARCHITECTURE.md),
> [Packaging](PACKAGING.md), and [Test Matrix](TEST_MATRIX.md).

## 1. Phase name

Phase 7 - Bounded active-workspace files, truthful diffs, and conflict-safe
accept/rollback in the frozen Inspector.

## 2. Completed work

- Added a Main-owned workspace content service. Renderer never receives Node,
  filesystem, Git-process, canonical-root, or absolute-path access.
- Added strict canonical relative-path validation and active-workspace/root
  revalidation before responses and immediately before mutations.
- Rejected absolute paths, Windows drive paths, empty/dot/parent segments,
  backslashes, NUL, sensitive credential names, traversal, external symlinks,
  and changed workspace ownership.
- Added lazy direct-child directory listing capped at 500 entries. Git metadata,
  dependencies, common build output, caches, virtual environments, and generated
  trees are ignored by default.
- Added truthful modified/added/deleted tree state from Git, including staged
  state, rename destinations, and deleted entries. A non-Git workspace degrades
  to observed Pi tool changes instead of presenting fabricated repository data.
- Added bounded text preview through a no-follow descriptor with stat-before/
  after consistency checks, explicit binary response, and explicit 512 KiB
  too-large response.
- Added actual bounded Git unified patches with external diff/text conversion
  disabled, binary handling, 200-file and 20,000-line response limits, and
  previous/next navigation in the existing Diff surface.
- Preferred a matching successful Pi tool patch when available. Fixed patch
  parsing so file-header-like text inside a hunk remains real content.
- Added accept for unchanged Git changes by staging the exact path. Non-Git Pi
  tool patches can be explicitly acknowledged without changing the file.
- Added confirmed rollback for tracked and untracked Git changes. Tracked files
  are restored atomically from the index with executable mode preserved;
  untracked files are removed only after explicit confirmation.
- Added strict reverse application for observed Pi Edit patches in non-Git
  workspaces. Unsupported patches fail closed.
- Added fingerprint conflict guards immediately before staging, rename, or
  unlink so edits made outside PiPilot are never overwritten.
- Added bounded, path-free workspace-content events and a short coalescing Git
  snapshot cache invalidated by tool, accept, and rollback actions.
- Connected real Electron Files/Diff data, loading, refresh, read-only preview,
  accept, rollback confirmation, conflicts, and modified counts to the existing
  Inspector and Sidebar. The browser fixture remains pixel-identical.
- Added all new visible text to both `zh-CN` and `en-US` catalogs.

## 3. Modified files

- `src/shared/workspace-content.ts`
- `src/shared/ipc/contracts.ts`
- `src/shared/pipilot-api.ts`
- `src/main/workspace/workspace-content-service.ts`
- `src/main/ipc/register-workspace-ipc.ts`
- `src/main/ipc/register-agent-ipc.ts`
- `src/main/index.ts`
- `src/preload/index.ts`
- `src/renderer/adapters/workspace-adapter.ts`
- `src/store/workspace.tsx`
- `src/components/inspector/InspectorPanel.tsx`
- `src/components/inspector/FileTree.tsx`
- `src/components/inspector/DiffViewer.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/App.tsx`
- `src/types/chat.ts`
- `src/i18n/locales/en-US.json`
- `src/i18n/locales/zh-CN.json`
- `tests/unit/workspace-content-service.test.ts`
- `tests/unit/ipc-contracts.test.ts`
- `tests/electron/pipilot.electron.spec.ts`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/PHASE_7_REPORT.md`

## 4. Purpose of each modified file

| File/group | Purpose |
| --- | --- |
| shared content types/contracts/API | Strict path, tree, preview, diff, mutation, event, IPC, and narrow facade definitions |
| Main content service | Canonical containment, bounded I/O, Git status/diff, tool fallback, fingerprint guards, atomic rollback, and events |
| Main IPC/app/Agent integration | Sender validation, safe error mapping, service lifecycle, and successful Pi tool-patch capture |
| preload and workspace adapter | Runtime-validated business invokes/subscription without raw IPC or filesystem escape hatches |
| workspace store and Sidebar | Real branch and modified-count refresh scoped to the active opaque workspace |
| Inspector/FileTree/DiffViewer | Lazy real tree, preview, diff navigation, accept, confirmed rollback, and conflict feedback in the frozen layout |
| chat types and locales | Real file/diff view-model fields and bilingual real-only strings |
| unit/Electron tests | Path, symlink, bound, preview, Git, tool fallback, conflict, bridge, UI, and no-path-leak evidence |
| docs | Implemented architecture, completion state, exact evidence, limitations, and Phase 8 handoff |

## 5. Dependencies added and reason

None.

Node filesystem/path/crypto/child-process APIs, Git, Zod, the existing Electron
bridge, React store, Vitest, and Playwright cover this phase. No package, Skill,
MCP server, browser binary, or `node_modules` file was installed or modified.

The repository Playwright dependency remains necessary for checked-in Electron
and visual tests. A Playwright MCP can operate a browser session but does not
replace the project runner, assertions, configs, or CI dependency.

## 6. New IPC

| Channel | Preload facade | Result |
| --- | --- | --- |
| `pipilot:workspace-files:list` | `files.list(workspaceId, path?)` | Bounded lazy directory snapshot |
| `pipilot:workspace-file:preview` | `files.preview(workspaceId, path)` | Bounded text, binary, or too-large outcome |
| `pipilot:workspace-diff:list` | `changes.list(workspaceId)` | Bounded real change summaries and branch |
| `pipilot:workspace-diff:read` | `changes.read(workspaceId, path)` | Bounded unified diff lines |
| `pipilot:workspace-diff:accept` | `changes.accept(...)` | Staged or acknowledged exact unchanged change |
| `pipilot:workspace-diff:revert` | `changes.revert(..., true)` | Explicitly confirmed conflict-safe rollback |
| `pipilot:workspace-content:changed` | `changes.subscribe(listener)` | Path-free-root content invalidation event |

No raw `ipcRenderer`, generic invoke/send, canonical path, Git command, or
filesystem primitive was exposed.

## 7. New shared types

- `WorkspaceRelativePath`
- `WorkspaceFileStatus`
- `WorkspaceTreeEntry`
- `WorkspaceDirectorySnapshot`
- `WorkspaceFilePreview`
- `WorkspaceDiffLine`
- `WorkspaceChangeSummary`
- `WorkspaceDiffSnapshot`
- `WorkspaceDiffFile`
- `WorkspaceChangeResult`
- `WorkspaceContentChangedEvent`

## 8. New runtime schemas

- canonical workspace-relative path;
- file status and bounded tree entry/directory snapshot;
- discriminated text/binary/too-large preview;
- bounded unified diff line and change summary;
- diff snapshot and diff-file response;
- accepted/reverted mutation result;
- path-relative workspace-content changed event;
- strict list, preview, read, accept, and confirmed-revert IPC request contracts.

All privileged request and response boundaries reject unknown or invalid fields.

## 9. Tests added

Unit coverage proves:

- canonical relative-path acceptance and traversal/absolute/backslash rejection;
- a literal `confirmed: true` is required for rollback;
- directory results are capped at 500 and ignore generated/cache trees;
- external symlinks and sensitive `.env` paths are omitted or rejected;
- text, binary, and oversized preview outcomes are explicit and bounded;
- a response becomes stale when the active workspace switches during I/O;
- Git rename numstat and hunk content resembling patch headers parse correctly;
- real Git patches are returned, matching tool patches are preferred, and
  accept stages the exact unchanged path;
- external edits cause a conflict and remain intact;
- tracked and untracked rollback behavior is safe;
- Git-absent workspaces expose no fabricated Git state;
- non-Git Pi Edit patches remain readable, acknowledgeable, and safely
  reversible while context/fingerprint mismatches fail closed.

Electron E2E additionally proves:

- the sandbox bridge exposes narrow `files` and `changes` business APIs;
- the real workspace tree is lazy and omits `node_modules`;
- text, binary, and large-file previews return the correct outcomes;
- preload rejects traversal before Main file access;
- actual diff lines appear in the existing Diff tab;
- accept stages an untracked Git file without changing its content;
- an external edit makes stale rollback fail without data loss;
- confirmed UI rollback restores a tracked file;
- Sidebar modified counts and content events refresh truthfully and omit the
  canonical temporary workspace path;
- a real approved Pi Edit in a non-Git workspace produces a tool-backed diff
  that can be acknowledged.

## 10. Verification commands

- bundled offline pnpm 11.16.0 `exec tsc --noEmit`;
- focused Vitest workspace-content and IPC-contract run;
- bundled offline pnpm 11.16.0 `run test:unit`;
- bundled offline pnpm 11.16.0 `run build`;
- focused and full Playwright Electron runs;
- comparison-only Playwright visual suite;
- bundled offline pnpm 11.16.0 `peers check`;
- `git diff --check`;
- focused secret/path, whitespace, generated-artifact, visual-baseline, staging,
  symlink, and Git-index hygiene checks.

## 11. Real result of each command

### TypeScript, unit tests, and build

- Final TypeScript: `tsc --noEmit` passed.
- Focused unit run: 2 files passed, 22 tests passed, 491 ms.
- Final unit suite: 11 files passed, 77 tests passed, 593 ms.
- Production build passed after its own typecheck.
- Main transformed 30 modules and emitted protocol chunk 18.35 kB, Agent Worker
  49.42 kB, and Main 151.25 kB.
- Preload transformed 87 modules and emitted 183.89 kB.
- Renderer transformed 647 modules and emitted HTML 1.56 kB, CSS 95.54 kB, and
  JavaScript 2,019.31 kB.
- `pnpm peers check`: no peer dependency issues.

### Electron integration and visual regression

- Focused Phase 6/7 integration run: 2 passed, 0 failed, 5.7 s. It exercised
  non-Git tool-backed changes and the complete Git file/diff workflow.
- Final Electron E2E: 6 passed, 0 failed, 19.8 s.
- Final visual comparison: 8 passed, 0 failed, 12.4 s.
- No visual baseline was regenerated or modified.

### Repository checks

- `git diff --check` passed with no whitespace errors.
- Focused source/test whitespace scan found no trailing whitespace.
- Focused source/test scan found no real home/workspace path, API-key-shaped
  value, or private-key marker in the Phase 7 surface.
- `git diff --name-only -- tests/visual/__screenshots__` returned no changed
  baseline file.
- No new Playwright result/report artifact appeared. Existing tracked
  `.playwright-mcp` log/snapshot deletions remain untouched.
- The Git index contains no mode `120000` entry and the staged diff is empty.
- Machine-local `.agents/skills` symlinks and their tracked-file deletion noise
  remain unstaged and untouched.

## 12. UI files modified

- `src/App.tsx`
- `src/components/inspector/InspectorPanel.tsx`
- `src/components/inspector/FileTree.tsx`
- `src/components/inspector/DiffViewer.tsx`
- `src/components/layout/Sidebar.tsx`
- `src/store/workspace.tsx`
- `src/types/chat.ts`
- both locale catalogs

No CSS, theme token, typography, spacing, radius, border, Markdown styling,
card structure, or visual baseline file was modified.

## 13. UI modification necessity

Phase 7 requires the frozen Files and Diff tabs to expose actual workspace
content and actions. Their existing regions therefore needed loading/refresh,
selection, read-only preview, real diff navigation, accept, confirmation, and
error state wiring. Static browser/visual mode retains the approved fixture and
DOM; the additional interactions exist only in real Electron mode.

本阶段只把真实文件树、只读预览、Diff、接受、确认回退和冲突反馈接入现有区域；未修改三栏布局、主题 Token、CSS、字号、间距、圆角、边框、信息密度、Markdown 样式或卡片结构。

## 14. Visual regression result

Passed: all 8 approved macOS dark/light references. No baseline was regenerated
or modified.

## 15. Mock data still in use

- Browser preview and visual tests intentionally retain the approved Files,
  Diff, Terminal, and Logs fixture.
- Electron Files and Diff are real for an active workspace; an Electron window
  without a workspace shows an empty state rather than mock data.
- Terminal and Logs remain mock/empty until Phase 8.
- Header model/provider/context usage and Provider settings remain Phase 9.
- Resource/MCP settings and diagnostics remain Phase 10.
- Electron E2E uses Pi's real session/runtime/tool implementations with its
  official faux model provider; production uses configured real Providers.

## 16. Known issues

- Git is considered available only when the active workspace is exactly the
  repository top-level. A directory nested inside a parent repository degrades
  to the explicit Git-unavailable/tool-observed fallback to avoid exposing
  parent content.
- Directory, preview, diff-file, diff-line, diff-byte, and rollback-byte limits
  are deliberately fixed and not yet configurable.
- Non-Git status can report only bounded Pi tool patches observed during the
  current Main-process lifetime; arbitrary external edits cannot be inferred
  without Git or a watcher.
- Non-Git accept acknowledges and removes the observed patch record. It does
  not invent a staging concept. Non-Git rollback is available only for strict,
  reversible Pi Edit hunks whose fingerprint and context still match.
- Git snapshots coalesce for 50 ms to avoid duplicate status processes. Tool,
  accept, and rollback actions invalidate the cache immediately.
- Terminal, provider credentials, resources, packaging, signing, notarization,
  and release security remain assigned to their ordered later phases.
- Bare Corepack pnpm remains unusable without registry access in this sandbox;
  verification used the bundled offline executable without changing packages.

## 17. Next phase plan

Phase 8 will connect the existing Terminal tab to a real manual PTY:

1. inspect installed dependencies and exact terminal/native-module APIs before
   selecting the smallest maintained PTY and terminal-renderer packages;
2. add typed create/input/resize/output/exit/kill contracts without exposing
   shell or raw IPC primitives;
3. run PTYs in Main or a dedicated utility process, bound to the active
   workspace with a terminal cap and deterministic child cleanup;
4. choose safe platform-default shells and keep manual input separate from the
   Agent permission policy;
5. apply existing mono font, code size, ligature, and wrapping settings to the
   current Terminal region without redesign;
6. verify cwd, resize, lifecycle, workspace switch, shutdown cleanup, native
   rebuild/packaging behavior, Electron workflow, and unchanged visuals.
