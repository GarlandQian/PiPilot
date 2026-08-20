# Implementation plan — Structured activity and file viewer

## [x] Phase 0 — Baseline and contract tests

- Capture current focused unit behavior for generic tool calls, subagent calls,
  response activity, Markdown rendering, and workspace previews.
- Add representative bounded fixtures matching the reported subagent payload,
  malformed/deep JSON, Markdown, JSONC/source, unknown text, binary, and
  oversized files.
- Confirm MCP/Models Form/JSON tests remain the regression boundary for exact
  JSONC draft preservation and secrets.

## [x] Phase 1 — Structured-value projection

- Add the pure iterative structured-value projector and discriminated types.
- Implement own-property inspection, JSON-text detection, summaries, exact
  bounded copy, truncation markers, and depth/item/string/total limits.
- Add focused tests for objects, arrays, scalars, malformed JSON-like strings,
  unsupported prototypes, getters, circular graphs, and large/deep inputs.
- Do not change shared Pi DTO schemas or Main/preload IPC.

## [x] Phase 2 — Conversation tool presentation

- Extend renderer-owned tool presentation types with structured detail groups.
- Add the exact-name tool presenter registry and generic fallback.
- Implement the dedicated `subagent` presenter with concise lifecycle/task
  summaries, Markdown task disclosure, normalized output, scheduler
  acknowledgement suppression, and a bounded ordered timeline derived from
  observable `results[].messages` progress/tool/result/error records.
- Update `ToolCallCard` to use shared disclosure rows, per-section copy, stable
  internal scrolling, the Codex-style execution timeline, and current PiPilot
  styling.
- Preserve specialized read/edit/shell summaries and response provenance.
- Keep Bash command/output presentation compact and omit its redundant generic
  Arguments section from display and copy.
- Update presentation tests for running, detached, completed, failed, malformed,
  and unknown-tool cases.

## [x] Phase 3 — Response activity and passive-output audit

- Apply structured detail projection to response-bound working, status, widget,
  notification, retry, and extension error rows without duplicating global
  notifications.
- Audit production renderer `JSON.stringify`, raw `<pre>`, and generic fallback
  sites. Migrate only passive displays.
- Explicitly retain MCP and Models editable JSONC surfaces and their single
  Form/JSON draft behavior.
- Add locale strings for new labels, disclosure actions, truncation, malformed
  values, and file modes in both catalogs.

## [x] Phase 4 — Persistent Inspector file detail

- Add a pure file-kind/language projector for validated relative preview paths.
- Add `WorkspaceFileViewer` and replace the current file-preview Dialog in the
  Files tab with tree/detail navigation.
- Reuse `MarkdownContent` for Markdown Preview and refactor/reuse the current
  highlighted code primitive for Source, code, JSONC, and plain text.
- Provide Back/Close, bounded path/type/size metadata, copy, line numbers, wrap,
  and Markdown Preview/Source controls.
- Preserve existing workspace preview IPC, security checks, byte limit, loading,
  binary/too-large states, epoch guards, and session-owned reset.
- Add component tests for mode selection, Back navigation, keyboard controls,
  stale responses, and overflow constraints.

## [x] Phase 5 — Visual and quality gate

- Run focused unit/component tests, then `pnpm typecheck` and `pnpm build`.
- Run the affected real Electron workflow against the final build at 1440 x 900
  and 1100 x 680 in light and dark themes.
- Inspect screenshots for compact hierarchy, readable structured rows, Markdown
  and source rendering, stable scroll regions, and no page-level horizontal
  overflow.
- Scan production renderer code again and document every retained raw JSON site
  as either an explicit editor or non-display serialization.
- Run `git diff --check` and confirm no unrelated product, Main/IPC, or package
  dependency changes.

Verified on the final worktree:

- `pnpm test:unit`: 66 files, 496 tests passed.
- Focused structured value, Subagent timeline, Bash presentation, and transcript
  projection: 4 files, 32 tests passed.
- MCP/Models regression: 7 files, 53 tests passed.
- `pnpm typecheck` and `pnpm build`: passed.
- Real Electron Composer/Subagent/Bash/File Viewer workflow: 1 test passed at the
  desktop and 1100 x 680 visual boundaries; inspected light/dark screenshots
  have no document-level horizontal overflow.
- Locale parity, task validation, and `git diff --check`: passed.
- No lint script exists in `package.json`; no new lint toolchain was introduced.

Retained raw-JSON/source sites after the production renderer scan:

- `settings-adapter.ts` and `layout-preferences.ts`: internal persistence only.
- Models/MCP form dialogs and `ModelsSettings.tsx`: dirty-state comparison or
  stable identity only; their explicit Raw JSONC editors remain intentional.
- `structured-value.ts`: bounded internal JSON serialization for semantic
  projection and copy, never a passive raw dump.
- `projector.ts`: fail-closed developer error text for an impossible protocol
  branch, not normal UI presentation.
- `CodeBlock.tsx`: the shared explicit source/code viewer; its `<pre>` regions
  are bounded and controlled by wrap/internal-scroll behavior.

## Risky files and ownership boundaries

- Conversation projection/types: `src/renderer/pi-rpc/presentation.ts`,
  `src/types/chat.ts`.
- Tool/activity UI: `src/components/chat/ToolCallCard.tsx`,
  `src/components/chat/ExtensionSurfaces.tsx`.
- Existing Markdown/code reuse: `src/components/chat/markdown/MarkdownContent.tsx`,
  `src/components/chat/markdown/CodeBlock.tsx`.
- Inspector/file ownership: `src/components/inspector/InspectorPanel.tsx` and a
  new focused viewer/helper module.
- Locale catalogs and focused unit/Electron tests.

Avoid Main, preload, shared Pi contracts, workspace security service, MCP/Models
draft architecture, dependencies, and unrelated conversation controls unless a
verified cross-layer defect makes a separately reviewed change necessary.
