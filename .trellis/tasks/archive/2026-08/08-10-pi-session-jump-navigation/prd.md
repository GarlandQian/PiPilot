# Conversation outline navigation

## Goal

Replace the developer-oriented Pi Session inspector with a clear conversation
outline. Users can scan the visible turns of the fully hydrated active
conversation and jump directly to the corresponding position in the middle
transcript without seeing Pi's raw session graph or protocol records.

## Background and Confirmed Facts

- The current Pi Session inspector separately calls official `get_entries` and
  `get_tree`, then renders entry types, IDs, timestamps, and a Pi Shell
  (`src/components/inspector/AgentContextPanel.tsx:209`,
  `src/components/inspector/AgentContextPanel.tsx:261`,
  `src/components/inspector/AgentContextPanel.tsx:490`).
- PiPilot already hydrates official `get_entries` centrally for response Fork
  provenance. `alignLocalPiMessageOrigins` validates the active leaf path and
  compaction boundary before associating visible messages with official entry
  IDs (`src/renderer/pi-rpc/response-provenance.ts:49`,
  `src/renderer/pi-rpc/response-provenance.ts:134`). No additional Main IPC or
  Pi RPC request is required for an outline.
- Projected ordinary turns do not currently retain their source entry identity,
  and the message list has no entry-addressable jump targets
  (`src/renderer/pi-rpc/presentation.ts:384`,
  `src/components/chat/MessageList.tsx:352`).
- `App` already coordinates the sibling message list and inspector, making it
  the appropriate owner for a session-scoped navigation request
  (`src/App.tsx:603`, `src/App.tsx:667`,
  `src/components/inspector/InspectorPanel.tsx:42`).
- Some official entries are intentionally absent from the visible conversation:
  entries on non-current branches, records discarded by compaction,
  model/thinking-level metadata, hidden custom records, and protocol-only
  lifecycle entries.
- A single visible assistant message may produce multiple transcript blocks
  such as thinking, text, tool calls, and results. Navigation needs one stable
  destination for the surrounding conversational turn.
- Session-owned renderer data is valid only after active scope, catalog
  selection, process generation, official session ID, and hydration all agree.
- The existing Terminal tab already provides manual shell access. The current
  Pi Shell is the only production consumer of renderer-owned direct-Bash state;
  official `bash` / `abort_bash` contracts and bounded Main host behavior are
  independently covered and remain supported.

## Requirements

### Conversation Outline

- Rename the right-side **Pi Session** tab to **Conversation outline**
  (`对话大纲` in Chinese).
- Replace Session tree, Raw history, and Pi Shell with one flat, user-facing
  outline for the fully hydrated active conversation.
- Produce one outline item per visible user-led conversational turn from the
  transcript's chronological source sequence, but render the outline latest
  first. Do not reverse or mutate the middle transcript itself.
- Use the user prompt as the primary label. Show a bounded assistant-response
  summary, current/completed/error state, and time only when authoritative data
  is available.
- Use validated official entry IDs only as internal identity. Do not display raw
  IDs or derive navigation by matching text, timestamps, array indexes, or DOM
  content.
- Omit non-current branches, compaction-discarded content, metadata-only
  records, hidden records, and any message whose provenance cannot be aligned
  exactly with the active official entry path.
- While the conversation is empty, loading, or failed, reuse the existing
  centered session-owned state instead of showing stale outline items.
- A ready conversation with no visible user-led turns shows a concise empty
  state.

### Navigation

- Every outline item is pointer- and keyboard-activatable.
- Arrow Up / Arrow Down / Home / End move focus through the latest-first visual
  order. Enter and Space continue to activate the focused item.
- Activation scrolls the middle transcript to the first visible block of that
  conversational turn and briefly highlights the destination.
- Keyboard focus remains on the activated outline item so repeated navigation
  remains efficient.
- Re-activating the same item triggers a new jump.
- A historical jump disables transcript follow-to-bottom. Later streaming or
  content resize must not immediately pull the user away; the existing
  “jump to latest” action resumes following.
- Respect reduced-motion preferences by using immediate scrolling and a
  non-animated emphasis treatment.
- Scope every request and anchor to the active session ID and runtime
  generation. Session replacement clears pending requests, registered anchors,
  active outline state, and highlight state before new content appears.

### Pi Shell Removal

- Remove the Pi Shell UI and renderer-only direct-Bash state, hooks, actions,
  projection helper, and UI-specific tests.
- Keep the existing Terminal tab unchanged for manual shell work.
- Keep official shared `bash` / `abort_bash` command and event schemas, Main
  runtime handling, timeouts, cancellation behavior, and host-level tests.

## Acceptance Criteria

- [ ] A ready conversation with three visible user-led turns shows three
      latest-first outline items with bounded user/assistant text and no raw
      IDs; the middle transcript remains chronological.
- [ ] Clicking an outline item scrolls to the correct first transcript block and
      applies a short visual emphasis.
- [ ] Enter and Space perform the same jump while focus remains in the outline.
- [ ] Arrow Up / Arrow Down / Home / End move focus in the same latest-first
      order shown on screen.
- [ ] Clicking the same item twice performs two distinct jumps.
- [ ] Thinking, text, and tool blocks belonging to one assistant response remain
      under the same user-led outline item rather than becoming raw entry rows.
- [ ] Other branches, compaction-discarded entries, metadata, hidden records,
      and unaligned provenance never appear as outline items.
- [ ] Switching session or generation during a pending jump cannot scroll or
      highlight the replacement conversation.
- [ ] After an upward jump, streaming and ResizeObserver updates do not restore
      bottom following until the user invokes “jump to latest” or naturally
      scrolls back to the bottom.
- [ ] Empty, loading, and error conversation states expose no prior-session
      outline data.
- [ ] The normal UI contains no Session tree, Raw history, raw entry IDs, or Pi
      Shell, and opening the outline does not issue `get_tree` or direct `bash`
      requests.
- [ ] Terminal remains available, while shared/Main official Bash support and
      its existing bounded cancellation tests remain intact.

## Out of Scope

- Browsing, switching, recovering, or mutating non-current Pi branches.
- A developer-facing raw protocol inspector or session-file viewer.
- Guessing destinations for entries that cannot be aligned to rendered content.
- Changing Pi session files, the official entry graph, session catalog, or
  active leaf as a navigation side effect.
- Removing official `get_tree`, `bash`, or `abort_bash` support from shared/Main
  protocol layers.
- Redesigning the Terminal tab.

## Technical Notes

- Project the outline from the same authoritative message/origin alignment used
  by the visible transcript and response Fork controls, not from a second
  inspector fetch.
- A declarative navigation request owned by `App` can connect the outline and
  message list without a global DOM query or cross-panel imperative handle.
- Preserve the current presentation gate and generation/session reset rules.
- Related decisions were recovered from project history with `trellis mem`: Pi
  history validation must remain iterative for very deep trees, and old
  session-owned UI must remain hidden until complete hydration. Removing the
  tree UI does not weaken the existing bounded Main/shared tree validation.
