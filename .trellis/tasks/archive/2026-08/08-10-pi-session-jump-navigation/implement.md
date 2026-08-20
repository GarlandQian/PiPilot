# Implementation Plan

## 1. Project Visible-Turn Provenance and Outline Data

- Carry aligned official source entry IDs into visible projected turns.
- Add a pure bounded outline projector that groups one user-led conversational
  turn across assistant text, thinking, tool, Plan, and visible custom content.
- Expose outline items with the transcript snapshot and reset them through the
  existing generation/session hydration boundary.
- Add focused projection tests for grouping, streaming replacement, compaction,
  unaligned provenance, bounded summaries, and other-branch exclusion.

Likely files:

- `src/types/chat.ts`
- `src/renderer/pi-rpc/presentation.ts`
- `src/renderer/pi-rpc/response-provenance.ts`
- `src/store/pi-rpc.tsx`
- `tests/unit/local-pi-rpc-renderer.test.ts`

## 2. Build the Conversation Outline and Jump Coordinator

- Replace `AgentContextPanel` with a flat `ConversationOutlinePanel`.
- Rename the inspector tab and locale copy to Conversation outline / 对话大纲.
- Render a copied reverse of the chronological outline so the newest turn is
  first, and keep Arrow Up / Arrow Down / Home / End aligned with that visual
  order without changing transcript order.
- Pass ready outline data and a session-scoped navigation callback through
  `InspectorPanel` and `App`.
- Register exact source-entry refs in `MessageList`; implement repeated jump,
  focus preservation, reduced-motion behavior, brief highlight, follow-to-bottom
  suspension, and replacement reset.
- Add focused component/helper coverage for item activation and stale requests.

Likely files:

- delete `src/components/inspector/AgentContextPanel.tsx`
- add `src/components/inspector/ConversationOutlinePanel.tsx`
- `src/components/inspector/InspectorPanel.tsx`
- `src/components/chat/MessageList.tsx`
- `src/App.tsx`
- `src/i18n/locales/en-US.json`
- `src/i18n/locales/zh-CN.json`
- replace `tests/unit/agent-context-panel.test.ts` with focused outline coverage

## 3. Remove the Renderer Pi Shell Surface

- Remove direct-Bash renderer state, contexts, hooks, actions, display helper,
  extension event wiring, and obsolete exports.
- Remove Pi Shell UI/locales and update production/Electron callers.
- Preserve shared official schemas, IPC contracts, Main host lifecycle logic,
  and host-level Bash timeout/cancellation tests.

Likely files:

- `src/store/pi-rpc.tsx`
- `src/components/inspector/AgentContextPanel.tsx` (deleted in step 2)
- `tests/unit/agent-context-panel.test.ts` (replaced in step 2)
- `tests/electron/pipilot.electron.spec.ts`

## 4. Verification

Finish all edits before running checks. Then run the focused gate first:

```bash
pnpm exec vitest run \
  tests/unit/local-pi-rpc-renderer.test.ts \
  tests/unit/conversation-outline.test.ts \
  tests/unit/i18n.test.ts \
  tests/unit/local-pi-runtime-host.test.ts
pnpm typecheck
pnpm build
pnpm exec playwright test --config=playwright.electron.config.ts \
  --grep "conversation outline|local Pi RPC workflow"
git diff --check
```

Because this changes shared renderer presentation/state, run the full unit suite
after the focused gate:

```bash
pnpm test
```

Electron verification must prove exact current-session navigation, repeated
activation, no previous-session items during replacement, no `get_tree` or
direct Bash command from the outline, Terminal availability, and no regression
to response Fork provenance. It must also prove a cold-start selection stays in
loading until the exact Main-confirmed generation/session is hydrated, with no
intermediate empty presentation.

## Ownership and Risk Points

- Re-read `App`, provider/store, inspector, MessageList, locales, and the shared
  Electron fixture immediately before editing because the current migration
  worktree is highly concurrent and dirty.
- Do not remove shared/Main official RPC support while deleting renderer-only
  direct-Bash state.
- Do not weaken hydration gating or response Fork provenance to simplify the
  outline.
- Preserve unrelated user changes and `.agents` symlink/deletion noise.

## Pre-Start Gate

- PRD has completed its convergence pass with no blocking open questions.
- Design and implementation plan are reviewed.
- `implement.jsonl` and `check.jsonl` contain real spec context.
- The user explicitly approves the final planning summary in a subsequent
  message before `task.py start` or product-code edits.
