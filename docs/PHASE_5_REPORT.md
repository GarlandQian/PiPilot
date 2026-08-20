# Phase 5 Report - Real Message Stream and Markdown

Date: 2026-08-07

> **Historical snapshot (2026-08-07):** This report preserves the evidence and
> assumptions of Phase 5. It is not current product or release authority. See
> [the documentation index](README.md), [Architecture](ARCHITECTURE.md),
> [Packaging](PACKAGING.md), and [Test Matrix](TEST_MATRIX.md).

## 1. Phase name

Phase 5 - Persisted Pi transcript history, batched streaming, and real Composer
actions in the frozen conversation surface.

## 2. Completed work

- Added a strict, path-free normalized transcript contract for user,
  Assistant, thinking, tool, and nonintrusive lifecycle notices.
- Added `session.history`, backed by the active Pi 0.84.0
  `SessionManager.getBranch()` rather than Renderer reconstruction.
- Projected visible text in branch order while deliberately excluding tool
  arguments, tool output, extension details, raw Provider errors, and session
  file metadata.
- Bounded history to 2,000 items, 4 million visible characters, and 200,000
  characters per visible item, with an explicit truncation flag.
- Added session epoch and worker sequence to history so events received during
  loading can be replayed only when newer than the authoritative snapshot.
- Fixed live message correlation for Pi's copied partial-message objects by
  using stable role/timestamp/tool-result keys rather than object identity.
- Added stream content indices and final stop reason to normalized events.
- Added a per-workspace/session normalized Renderer store keyed by message ID.
- Filtered events by runtime generation, session ID, session epoch, and
  monotonic sequence, and cleared transient error state on replacement.
- Batched text/thinking deltas and tool updates through one
  `requestAnimationFrame` publication.
- Kept high-frequency transcript subscriptions below App and used cached turn
  objects plus memoized rows, so token updates do not rerender Sidebar,
  ChatHeader, Composer, Inspector, or completed rows.
- Reconciled optimistic/live rows with persisted history without replacing
  their React identity at settlement.
- Connected the existing Composer to real prompt and abort operations in
  Electron mode; browser preview retains its deterministic interaction.
- Connected MessageList to real chronological history, Assistant Markdown,
  thinking, tool states, Abort/error outcomes, and compaction notices.
- Preserved existing GFM, raw-HTML exclusion, safe URL handoff, code controls,
  table bounds, fonts, sizes, widths, and Markdown styling.
- Improved bottom following to react to streamed content and delayed layout
  changes only while the reader remains near the bottom.
- Added bilingual text for the new real-only thinking, compaction, failure, and
  abort states.

## 3. Modified files

- `src/shared/agent-protocol.ts`
- `src/shared/ipc/contracts.ts`
- `src/shared/pipilot-api.ts`
- `src/agent-worker/index.ts`
- `src/agent-worker/transcript.ts`
- `src/main/ipc/register-agent-ipc.ts`
- `src/preload/index.ts`
- `src/renderer/adapters/message-adapter.ts`
- `src/store/message-reducer.ts`
- `src/store/messages.tsx`
- `src/main.tsx`
- `src/App.tsx`
- `src/components/chat/MessageList.tsx`
- `src/components/chat/Composer.tsx`
- `src/types/chat.ts`
- `src/i18n/locales/en-US.json`
- `src/i18n/locales/zh-CN.json`
- `tests/unit/agent-protocol.test.ts`
- `tests/unit/message-reducer.test.ts`
- `tests/unit/transcript-projection.test.ts`
- `tests/electron/pipilot.electron.spec.ts`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/PHASE_5_REPORT.md`

## 4. Purpose of each modified file

| File/group | Purpose |
| --- | --- |
| shared protocol/contracts/API | Strict transcript types, history operation/channel, event correlation fields, and narrow facade |
| worker transcript/runtime | Pi branch projection, stable live message identity, safe outcomes, and bounded history response |
| Main/preload | Trusted sender validation, response validation, and typed `session.history()` exposure |
| message adapter/reducer/store | Electron facade selection, pure normalized reduction, per-session isolation, event buffering, and frame batching |
| App/main entry | Provider wiring and Electron-vs-web conversation data source selection |
| MessageList/Composer/types | Chronological real turns, memoized rows, scroll following, send/abort actions, and real-only lifecycle rendering |
| locale catalogs | Matching `zh-CN` and `en-US` state strings |
| tests | Protocol privacy, projection, reducer isolation/outcomes, and real Electron workflow evidence |
| docs | Current architecture, completion status, evidence, limitations, and Phase 6 handoff |

## 5. Dependencies added and reason

None.

The existing Pi SDK, Zod, React external-store APIs, React Markdown stack,
React Icons, Electron bridge, Vitest, and Playwright cover this phase. No Skill,
MCP package, state library, Markdown parser, browser binary, or package update
was installed. No `node_modules` file was edited.

## 6. New IPC

| Channel | Preload facade | Result |
| --- | --- | --- |
| `pipilot:session:history` | `session.history()` | Current session ID/epoch/sequence plus bounded normalized transcript |

Existing `pipilot:agent:event` payloads can additionally carry bounded
`contentIndex`, ISO timestamp, and sanitized Pi stop reason. They still contain
runtime generation, event sequence, session ID, and session epoch. No raw IPC
escape hatch was added.

## 7. New shared types

- `AgentMessageState`
- `AgentToolState`
- `AgentTranscriptItem`
- `AgentTranscriptSnapshot`
- `NormalizedMessageState`
- Renderer `TranscriptSnapshot` and `StatusSnapshot`
- `thinking` and `notice` conversation turns

Transcript types have no path, argument, raw output, error-message, auth, or
stack fields.

## 8. New runtime schemas

- Assistant state: `streaming | complete | aborted | error`;
- tool state: `queued | running | waiting-approval | success | failed |
  cancelled`;
- strict transcript union for user, Assistant, thinking, tool, and notice;
- bounded transcript response with session ID, positive epoch, nonnegative
  sequence, truncation flag, and at most 2,000 items;
- optional event content index, ISO timestamp, and known Pi stop reason;
- strict empty request and transcript response for `session.history`.

Unknown fields remain rejected by Zod at Worker, Main, and preload boundaries.

## 9. Tests added

The unit suite now includes:

- transcript history schema validation and rejection of an added absolute-path
  field;
- optimistic user reconciliation and multi-delta batch reduction;
- Abort outcome distinction;
- stale sequence and cross-session event rejection;
- authoritative history replacement and live React-row identity retention;
- Pi branch projection order and tool argument/output/error-detail redaction.

Electron E2E now additionally proves:

- all text deltas for one Pi response share one stable message ID;
- persisted `session.history()` contains the real user/Assistant exchange;
- the existing Composer submits a real Pi prompt;
- Assistant Markdown renders a heading, GFM table, and incomplete fenced code
  without widening the conversation main area;
- history results do not expose the selected workspace path;
- switching workspaces removes the prior workspace transcript;
- existing Abort, session replacement, crash recovery, and restart behavior
  still works.

## 10. Verification commands

- installed Pi 0.84.0 `.d.ts` and bundled source inspection;
- `pnpm typecheck`;
- `pnpm test:unit`;
- `pnpm build`;
- `./node_modules/.bin/electron-vite build` after the separate typecheck;
- `pnpm test:electron`;
- `pnpm test:visual`;
- `pnpm peers check`;
- `git diff --check`;
- focused secret/path, whitespace, generated artifact, and Git index mode checks.

## 11. Real result of each command

### API inspection, TypeScript, and unit tests

- The official web search service returned HTTP 503 due unavailable
  authentication. The exact installed and locked 0.84.0 Pi declarations and
  bundled source were therefore used as the version authority.
- They confirmed `SessionManager.getBranch()`, append-only session entries,
  copied partial Assistant messages, content-indexed stream events, final stop
  reasons, tool lifecycle events, and `AgentSession.abort()` semantics.
- Initial bare `pnpm` checks did not enter project code because Corepack tried
  to resolve `pnpm/latest` through the blocked registry.
- The bundled offline pnpm 11.16.0 executable ran `tsc --noEmit` successfully.
- Final `pnpm test:unit`: 8 files passed, 44 tests passed, 538 ms.

### Build

- `pnpm build` could not enter its nested bare `pnpm typecheck` command because
  that executable hit the same Corepack registry lookup.
- Equivalent verified steps, `tsc --noEmit` plus
  `./node_modules/.bin/electron-vite build`, passed.
- Main transformed 23 modules and emitted protocol chunk 12.89 kB, Agent
  Worker 30.49 kB, and Main 76.13 kB.
- Preload transformed 85 modules and emitted 170.26 kB.
- Renderer transformed 646 modules and emitted HTML 1.56 kB, CSS 94.92 kB,
  and JS 1,978.32 kB.

### Electron integration and visual regression

- One later E2E run exposed a test race: the Markdown heading became visible
  before streaming settled, so an immediate unconfirmed Fork was correctly
  rejected by Main. The test now waits for Runtime `ready` before Fork.
- Final Electron E2E: 3 passed, 0 failed, 12.9 seconds in the approved desktop
  environment.
- Visual comparison ran all 8 existing cases. Playwright recorded
  `status: passed` with an empty failed-test list.
- No screenshot baseline was updated.

### Repository checks

- `pnpm peers check`: no peer dependency issues.
- `git diff --check`: passed.
- Focused sensitive-field and whitespace searches returned no new issue.
- Git index contains zero mode-120000 entries. Local `.agents/skills` links
  remain ignored and none of their tracked deletion noise was staged.

## 12. UI files modified

- `src/App.tsx`
- `src/main.tsx`
- `src/components/chat/MessageList.tsx`
- `src/components/chat/Composer.tsx`
- `src/store/messages.tsx`
- `src/types/chat.ts`
- both locale catalogs

No CSS or theme file was modified.

## 13. UI modification necessity

This phase explicitly replaces the frozen conversation fixture with real Pi
history and stream events. MessageList and Composer therefore required data and
action binding. Thinking, Abort/error, and compaction need small existing-scale
status rows so the real state is not hidden. These rows render only when the
corresponding Electron event exists; browser preview normal-state DOM remains
the approved fixture.

本阶段只将真实消息、发送、中止、Thinking 与 Compaction 状态接入冻结对话区；未修改三栏布局、主题 Token、CSS、字号、间距、消息宽度、Markdown 样式、ToolCallCard 或 ApprovalCard 视觉结构。

## 14. Visual regression result

Passed: all 8 approved macOS references, with no failed test and no baseline
file update.

## 15. Mock data still in use

- Browser preview and visual tests intentionally retain the original complete
  conversation fixture.
- Real tool arguments/output, approval decisions, permission rules, and diff
  payloads remain Phase 6 work; Phase 5 exposes only safe tool identity/status.
- Header model/provider and context usage remain mock until Phase 9.
- Composer file/context attachment controls are not yet connected to files;
  the fake `src/main.ts` chip is removed in Electron mode.
- Inspector Files/Diff/Terminal/Logs remain mock until Phases 7 and 8.
- Settings resource/provider/permission surfaces remain scheduled work.

Electron user messages, Assistant Markdown, thinking, tool lifecycle state,
compaction/outcome notices, prompt submission, Abort, persisted history, and
session/workspace isolation are real in this phase.

## 16. Known issues

- `waiting-approval` is represented in the unified state and normalized tool
  schema, but no real permission request can occur while Phase 3 built-in tools
  remain disabled. Phase 6 supplies the enforcement and ApprovalCard data.
- Tool cards intentionally receive name and status only. Arguments, command or
  path summaries, duration, output, and diffs stay outside Renderer until the
  Phase 6 permission boundary is implemented.
- The current Worker history operation returns only the already-active
  session. Main switches/binds a selected session before the Renderer requests
  its history; arbitrary session-file access is intentionally unavailable.
- The existing Phase 3 extension UI, resource rollback, Provider auth,
  packaging, fuse, signing, and notarization limitations remain.
- Bare Corepack `pnpm` currently attempts an unavailable registry lookup in
  this sandbox. Verification used the preinstalled offline pnpm executable and
  direct local build binary without changing project dependencies.

## 17. Next phase plan

Phase 6 will make the already-structured tool/approval surfaces authoritative:

1. re-inspect the installed Pi 0.84.0 tool definitions, execution callbacks,
   extension hooks, and cancellation behavior;
2. add a Main/Worker permission protocol keyed by workspace, session, and
   `toolCallId`;
3. classify read, write, shell, network, destructive, publish, and external
   operations before execution;
4. connect true command/path summary, duration, bounded output, and unified
   patch data to the existing ToolCallCard/DiffViewer;
5. connect one-shot/session/workspace/permanent approval choices to the
   existing ApprovalCard while preventing wrong-session decisions;
6. cancel queued tools and approvals on Abort or session replacement;
7. prove unapproved Shell/write operations cannot execute and rerun all frozen
   visual references.

## Completion audit addendum - 2026-08-08

The bounded-history truncation flag is now visible through a localized,
nonintrusive status row at the top of the existing conversation log. The
2,000-item, 4-million-character, and per-item bounds remain unchanged; no raw
omitted content crosses into Renderer state. The default deterministic visual
fixtures are not truncated, so all 10 comparison-only baselines passed without
an update.
