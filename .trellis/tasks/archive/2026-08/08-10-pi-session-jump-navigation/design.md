# Technical Design

## Boundaries

The feature is renderer-only. It consumes the official active-path provenance
that the provider already hydrates and does not add IPC, read session files,
invoke `get_tree`, or mutate Pi state.

Main and shared protocol support for `get_entries`, `get_tree`, `bash`, and
`abort_bash` remains unchanged. The existing provider continues to fetch
`get_entries` because response Fork and conversation provenance depend on it.

## Authoritative Projection

Extend the current presentation projection with a bounded outline model:

```ts
type PiConversationOutlineItem = {
  id: string
  anchorEntryId: string
  title: string
  summary?: string
  timestamp?: number
  state: 'running' | 'complete' | 'error' | 'aborted'
}
```

`id` and `anchorEntryId` derive from the validated official user entry. They are
internal identity, not display strings. Title and summary are bounded before
entering component state.

Projection follows these rules in one pass over the already aligned visible
message sequence:

1. If entry provenance alignment is absent or fails, produce no outline. Never
   fall back to message indexes or text matching.
2. Start an outline group only at a visible user message with an official user
   entry ID on the active path.
3. Associate subsequent assistant, thinking, tool-result, Bash-execution,
   supported Plan, and visible custom blocks with that group until the next
   visible user message.
4. Use the first bounded non-empty assistant text as the secondary summary;
   fall back to a bounded visible tool/plan label only when no assistant text is
   present.
5. Derive state from the same authoritative response state used by the rendered
   transcript. A streaming replacement updates the current item rather than
   creating a duplicate.

Visible `Turn` records carry an optional source entry ID. The first rendered
turn with the group's `anchorEntryId` becomes its DOM anchor. This keeps one
identity chain from official entry -> projection -> outline -> message ref.

## Outline UI

Replace `AgentContextPanel` with `ConversationOutlinePanel`:

- one flat scrollable list, with no nested Tree / Entries / Shell tabs;
- latest visible turn first, derived by reversing a copy of the chronological
  outline projection without mutating the projection or transcript;
- bounded prompt and response text, state indicator, and authoritative time;
- native button semantics for pointer, Enter, Space, focus ring, and disabled
  handling;
- Arrow Up / Arrow Down / Home / End move focus by the latest-first visual DOM
  index;
- a ready-empty message when projection yields no user-led turns;
- no raw entry type, ID, parent, leaf, branch, or protocol metadata.

`InspectorPanel` retains its existing session presentation gate. The tab value
and locale label become `outline`; empty/loading/error states continue to own
the full panel and therefore cannot leak previous-session items.

## Navigation Coordination

`App` owns a declarative request:

```ts
type ConversationJumpRequest = {
  sessionKey: string
  anchorEntryId: string
  sequence: number
}
```

The session key includes active scope, official session ID, and runtime
generation. `sequence` makes repeated activation of the same item observable.

`MessageList` registers element refs by source entry ID while rendering. On a
matching request it:

1. verifies the request session key against the current ready presentation;
2. finds the exact registered anchor without querying or matching DOM text;
3. disables follow-to-bottom before scrolling;
4. scrolls to `block: 'start'`, using smooth behavior only when reduced motion
   is disabled;
5. applies a short, session-scoped highlight; and
6. leaves focus in the outline.

The existing scroll handler resumes following when the user reaches the bottom;
the existing “jump to latest” action also resumes it. Session or generation
replacement resets the request and ref/highlight state, so a late effect cannot
act on the replacement transcript.

## Pi Shell Cleanup

Delete the Pi Shell component and renderer-only direct-Bash surface:

- `PiDirectBashState`, reducer/projection helper, React contexts, hooks, and
  actions in the renderer store;
- Bash update handling that exists only to feed that removed UI;
- Pi Shell locale strings and UI/Electron assertions.

Do not narrow the shared official command/event union or remove the Main host's
Bash-specific timeout/abort behavior. Those are protocol/runtime capabilities,
not the removed product surface.

## Error, Accessibility, and Performance

- Projection is linear in the hydrated visible message count and does not walk
  the recursive session tree.
- Cap displayed title/summary lengths and keep full raw protocol objects out of
  the outline component.
- Missing anchors fail silently after session-key validation; they must not
  approximate a destination or open a global error modal.
- Use semantic buttons/list labels and visible focus styles. Announce empty and
  loading states through the existing panel semantics.
- Reduced motion disables smooth scroll and animated highlight transitions.

## Rollback

The change does not migrate persisted data or alter Pi sessions. A renderer
rollback can restore the old inspector while shared/Main RPC behavior remains
compatible. No user settings migration is required.
