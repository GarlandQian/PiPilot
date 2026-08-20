# Implementation Plan

## 1. Refresh Guidance And Lock Renderer Contracts

- Load the current frontend component, state, official Pi renderer, quality,
  code-reuse, PiPilot UI-style, React, Vitest, and Electron guidance.
- Re-read `MessageList`, `ToolCallCard`, the tool presenters, current subagent
  timeline tests, `App`, and both Inspector branches before editing.
- Record the final response-local activity, shell evidence, and subagent
  Inspector types in the existing Renderer/type owners. Do not add a dependency
  or change Main/preload/shared IPC.

## 2. Build The Pure Activity And Shell Projectors

- Add the response-local projector that replaces contiguous tool turns with
  stable bounded activity runs and category sections.
- Preserve exact source order, stable call IDs, status/error visibility, and
  unknown fallback; never group across non-tool narrative or response scope.
- Add the conservative shell evidence classifier and Formatted/Raw projection.
- Cover single/repeated/mixed categories, streaming updates, Markdown and raw
  terminal cases, truncation, and copy-source invariants with focused Vitest.

## 3. Replace Transcript Tool Cards With Compact Activity Regions

- Add the compact activity region/summary/item components and integrate them at
  the `MessageList` response-group boundary.
- Decompose reusable status/evidence pieces from `ToolCallCard`; do not copy its
  structured parsing or status maps into parallel implementations.
- Keep Bash command/evidence inline, omit Arguments, render eligible output via
  `MarkdownContent`, and retain exact Raw evidence.
- Keep file/edit/generic/approval/failure details inline and preserve bounded
  generic structured fallback.
- Preserve transcript anchors, chronological narrative, follow-to-bottom,
  typewriter behavior, response actions, and stable React identities.

## 4. Add The Subagent Contextual Inspector

- Add App-owned identity-only subagent selection and close/focus-return request.
- Make subagent activity rows open the Inspector and pass the current resolved
  call only when session/scope/generation identity remains exact.
- Add `SubagentExecutionPanel` using the existing cleaned task Markdown,
  bounded timeline, final output/error, and scoped copy behavior.
- Render the contextual panel without adding a permanent Inspector tab and keep
  the prior tab subtree/state mounted, including Terminal.
- Implement follow-latest pause/resume, Back/Close, Escape ownership, focus
  restoration, and immediate stale-detail clearing.
- Cover single, parallel, chain, running, completed, failed, missing timeline,
  streamed replacement, and session switch cases.

## 5. Complete Visual, Locale, And Accessibility Work

- Add concise matching EN/ZH labels for activity counts, formatted/raw output,
  subagent detail navigation, timeline states, and omitted/truncated evidence.
- Reuse semantic tokens, density variables, Markdown/code renderers, UI
  primitives, and Tabler icons; remove nested-card styling from the activity
  path.
- Verify focus rings, `aria-expanded`/`aria-controls`, live regions, status
  contrast, long command/task truncation, reduced motion, and 1100x680 layout.
- Run the Impeccable detector once after the UI batch and address findings
  without introducing a second visual language.

## 6. Verification And Contract Recording

After related edits are complete, run focused checks first:

```bash
pnpm exec vitest run \
  tests/unit/tool-activity-presentation.test.ts \
  tests/unit/tool-presenters.test.ts \
  tests/unit/subagent-tool-call-card.test.ts \
  tests/unit/local-pi-rpc-presentation.test.ts
pnpm typecheck
pnpm build
pnpm exec playwright test \
  --config=playwright.electron.config.ts \
  --grep "tool activity|subagent activity"
git diff --check
```

The real Electron scenario must prove:

- repeated Bash calls aggregate and expand in order;
- Markdown-shaped Bash results format correctly and Raw preserves source;
- terminal/log/JSON output defaults to Raw;
- a subagent row opens a live right-side execution timeline;
- Back/Close restores the previous Files/Changes/Outline/Terminal tab;
- a session/generation replacement clears the detail and cannot leak old data;
- parallel/chain tasks, failures, unknown tools, keyboard, focus, both themes,
  both locales, reduced motion, and 1100x680 have no overlap or page overflow.

Capture and inspect current-worktree screenshots rather than reusing temporary
or historical artifacts. Update `.trellis/spec/frontend/official-pi-renderer.md`
and the PiPilot UI skill references only after the behavior is verified and
only where a durable contract actually changed.

## Risky Files And Rollback Points

- `src/components/chat/MessageList.tsx`: owns response anchors, scroll following,
  typewriter, and response actions. Activity projection must not disturb these.
- `src/components/chat/ToolCallCard.tsx`: currently mixes status shell and
  evidence. Extract reusable pieces before retiring the full-card path.
- `src/renderer/pi-rpc/presentation.ts` and `tool-presenters.ts`: retain the
  authoritative sanitization/provenance rules; avoid a second parser.
- `src/App.tsx`: bind selection to the exact conversation key and preserve all
  session loading/opening guards.
- `src/components/inspector/InspectorPanel.tsx`: keep Files/Changes/Outline and
  activated Terminal mounted/stateful beneath contextual detail.
- Locale catalogs and the shared Electron spec are high-churn; re-read before
  editing and preserve unrelated worktree changes.

Rollback is a Renderer-only revert of projector/components/App/Inspector
wiring. No protocol, host, filesystem, or persisted-data rollback is involved.

## Pre-Start Gate

- PRD convergence pass, design, implementation plan, and both context manifests
  validate.
- No unresolved product, compatibility, or risk decision remains.
- The user reviews the final planning summary and explicitly approves
  implementation in a subsequent message before `task.py start` runs.

## Implementation Result

Implemented the Renderer-only cutover without changing Main, preload, IPC, the
Pi Host, persisted data, versioning, or release configuration.

- `projectToolActivitySequence()` now projects contiguous response-local tool
  runs into stable command, subagent, file, edit, and fallback sections while
  preserving every non-tool turn in source order.
- Bash keeps the command as bounded monospace evidence, omits the transport
  argument object, and uses a conservative UTF-8-bounded Markdown/Raw
  presentation with exact-source copy.
- Exact subagent rows open a contextual Inspector layer by
  `{ sessionKey, toolCallId, sequence }`. The current call is resolved from the
  active transcript, stale session/generation selection disappears, and the
  previous Inspector tab remains mounted beneath the detail.
- The subagent detail defaults delegated task Markdown to a closed secondary
  disclosure, renders the bounded observable execution timeline/result, follows
  latest only while the user remains near the bottom, respects reduced motion,
  and returns focus to the originating row when closed.
- New visible labels are present in both locales and the UI reuses PiPilot
  tokens, primitives, Markdown rendering, and Tabler icons.

Verification on the final source batch:

- `./node_modules/.bin/vitest run tests/unit` -> 67 files / 514 tests passed.
- Focused activity/presenter/subagent/renderer/i18n batch -> 6 files / 64 tests
  passed.
- `./node_modules/.bin/tsc --noEmit` -> passed.
- `./node_modules/.bin/electron-vite build` -> Main/preload/renderer passed.
- `git diff --check` and locale key parity -> passed.
- Impeccable detector over the changed Renderer surfaces -> `[]`.
- `pnpm exec playwright test --config=playwright.electron.config.ts
  tests/electron/pipilot.electron.spec.ts --grep "runs Composer mentions"` ->
  1 test passed against the final default-fold implementation. The composite
  workflow covers contextual subagent detail, Markdown/Raw Bash, session
  replacement, light/dark screenshots, and 1100x680 no-overflow.
