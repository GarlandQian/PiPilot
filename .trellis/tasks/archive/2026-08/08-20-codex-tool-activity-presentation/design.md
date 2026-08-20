# Technical Design

## Architecture

```text
authoritative projected Turn[]
  -> groupConversationTurns()                    existing response ownership
  -> projectToolActivitySequence()              new pure Renderer projector
       |-- narrative/non-tool turns             original order
       `-- contiguous tool runs
            `-- category summaries + ordered items
                         |
                         v
                ToolActivityRegion              compact inline transcript UI
                  |-- Bash formatted/raw detail
                  |-- file/edit/generic evidence
                  `-- subagent summary ----------+
                                                   |
                                                   v
App: { sessionKey, toolCallId, sequence }           contextual selection only
  -> resolve current ToolCall from transcript       no duplicated call state
  -> open existing Inspector
  -> SubagentExecutionPanel                         live task/timeline/result
```

The Pi SDK, utility host, Main, preload, IPC, and shared protocol remain
unchanged. The existing Renderer transcript is the sole source of truth.

## Response-Local Activity Projection

Add a pure projector near the current presentation layer. It receives the turns
of one `ConversationResponseGroup` and returns a display sequence containing
the original non-tool turns plus compact activity runs.

```ts
type ToolActivityCategory =
  | 'commands'
  | 'subagents'
  | 'files'
  | 'edits'
  | 'other'

type ToolActivityItem = {
  id: string                 // existing ToolCall.id
  category: ToolActivityCategory
  order: number
  call: ToolCall
}

type ToolActivitySection = {
  id: string                 // response/run/category/first-call identity
  category: ToolActivityCategory
  items: readonly ToolActivityItem[]
  status: ToolCall['status']
  failedCount: number
}

type ToolActivityRun = {
  id: string
  sections: readonly ToolActivitySection[]
}
```

Exact names may adapt to local naming, but the invariants are fixed:

- Split tool activity into contiguous runs so intervening assistant narrative,
  notices, plans, or response actions never move across tool evidence.
- Classify only from the existing `ToolCall.kind` and exact subagent
  presentation. Do not parse user-visible titles to infer semantics.
- Preserve source order within each section. Section order is the first source
  occurrence of that category in the run.
- A section ID starts from the first stable call ID and does not change when a
  streamed update adds later calls or changes status.
- One item may render directly without a redundant count layer. Repeated items
  render one category/count/status summary and an ordered disclosure.
- Failed, cancelled, detached, and running states remain visible in the closed
  summary. Unknown/generic calls always remain as bounded items.
- Projection is total, bounded, and immutable. It never mutates the transcript
  turns or creates another event cursor.

`MessageList` continues to own response anchors, follow-to-bottom, typewriter,
and session jump behavior. It delegates each projected run to a new compact
activity component instead of mapping every tool directly to a full card.

## Inline Activity UI

Use one unframed activity region per contiguous run. Hairline connectors,
compact rows, muted icons, and type hierarchy carry structure; do not nest
decorative cards.

Collapsed category row:

```text
chevron  icon  Ran 10 commands            1 failed
chevron  icon  Created 2 agents            Completed
chevron  icon  Updated 4 files             +120 / -36
```

Expanded category rows retain chronological order. Each item has one readable
action line, state, and an optional evidence disclosure. Copy actions appear
only beside the evidence they copy. A failed item opens automatically when it
first transitions to failed; settled success remains compact unless the user
explicitly opens it. Explicit expansion state survives streamed updates while
the stable call/section ID remains present.

The existing `ToolCallCard` should be decomposed rather than copied:

- share status icons/labels and evidence renderers;
- move generic structured evidence into a reusable detail component;
- use a dedicated compact Bash detail;
- remove the full-card shell from the transcript activity path;
- retain a bounded generic fallback for unsupported tools.

## Bash Evidence Presentation

Add a pure, deterministic `projectShellEvidence()` presentation helper over the
existing bounded result/progress/error source text.

```ts
type ShellEvidencePresentation = {
  source: string
  defaultView: 'formatted' | 'raw'
  formattedMarkdown?: string
  truncated: boolean
}
```

The classifier is conservative:

- Use formatted Markdown only when clear Markdown structure exists, such as a
  heading, list, blockquote, fenced code, link, or Markdown table, and no strong
  terminal signal is present.
- Default to Raw for ANSI/control sequences, carriage-return progress,
  parseable JSON, tabular/tab-delimited output, timestamp/level-heavy logs, or
  ambiguous plain output.
- The existing safe `MarkdownContent` renders formatted evidence. Raw uses the
  existing bounded monospace/code treatment with horizontal overflow contained
  inside the evidence region.
- Formatted evidence exposes a localized Formatted/Raw segmented control. Raw-
  only evidence does not show a meaningless toggle.
- Copy always uses the same bounded source string, never reconstructed rendered
  DOM text.
- Commands remain raw monospace and never appear under an Arguments heading.
- Errors use the same classifier but retain destructive status semantics.

This changes presentation only. It does not strip or invent execution facts and
does not modify Pi-owned output.

## Subagent Contextual Inspector

Only subagent activity opens the right Inspector. Bash and every other tool
remain inline.

App owns a transient identity request:

```ts
type SubagentInspectorSelection = {
  sessionKey: string
  toolCallId: string
  sequence: number
}

type SubagentInspectorFocusRequest = {
  sessionKey: string
  toolCallId: string
  sequence: number
}
```

Selection stores no task text, timeline, output, or status. On each render, App
resolves the exact current `ToolCall` from `transcript.turns` and passes it only
when all of these remain true:

- conversation presentation is ready;
- current conversation session/generation key equals `selection.sessionKey`;
- a tool turn with `selection.toolCallId` exists;
- that call still has a valid subagent presentation.

Otherwise App clears the selection before stale content can render. Opening a
selection sets `frameNav.inspectorOpen = true`.

`InspectorPanel` retains its current tab state. While a valid selection exists,
it renders a contextual detail header/body over the tab content rather than a
fifth tab. The underlying tab subtree remains mounted, including a previously
activated Terminal, so inspecting a subagent does not dispose another
workspace-owned surface. Back/Close clears the selection and reveals the same
tab. A focus request returns keyboard focus to the originating subagent row if
it still exists in the same session.

The contextual panel contains:

1. Compact Back, task/agent title, live status, and Close controls.
2. Cleaned bounded task Markdown in a secondary disclosure.
3. The existing observable chronological timeline with agent/tool/status
   labels and Markdown content.
4. Bounded final result or error, without duplicating an identical final
   timeline event.
5. Copy controls scoped to task, event, or final evidence.

For parallel/chain calls, the panel shows the call-level task list and the
ordered combined observable timeline. It does not invent per-task filtering
unless the presenter has an exact stable task identity for each event.

Timeline follow behavior mirrors the transcript: follow latest while near the
bottom, pause when the user scrolls away, and show an explicit resume control.
Reduced motion disables animated scrolling. Streaming updates reconcile by
stable timeline event ID and never reset the user's scroll or disclosure state.

## Accessibility And Keyboard Contract

- Activity summaries and evidence disclosures are native buttons/details with
  Enter/Space activation, visible focus, and accurate `aria-expanded`.
- Subagent rows advertise and open the contextual detail region; the panel has
  a localized accessible title.
- Back and Close are distinct commands with Tabler icons, tooltips where
  needed, and localized `aria-label`s.
- Escape closes the contextual detail only when focus is inside it and no
  nested disclosure/menu owns Escape.
- Closing emits the identity-scoped focus request. A late request after session
  replacement is ignored.
- Streaming status uses one restrained live status; timeline content is not
  repeatedly announced line by line.
- All new visible copy is present in both locales and fits Chinese at 1100x680.

## Styling And Responsive Behavior

Reuse semantic PiPilot tokens, current row-height/density variables,
`MarkdownContent`, code rendering, Button/Tooltip/Collapsible primitives, and
the current Tabler icon family. The conversation remains visually primary;
activity is a quiet evidence rail, not nested cards.

At 1100x680, inline summaries truncate bounded secondary text without hiding
status. The existing frame decides whether the Inspector is visible; explicitly
opening a subagent detail reopens it. The detail pane owns vertical scrolling
and never introduces page-level horizontal scrolling. Verify light/dark,
reduced motion, compact/comfortable density, and both locales.

## Compatibility, Migration, And Rollback

There is no persisted UI migration and no compatibility branch for 0.0.1.
Existing transcript and Pi contracts remain valid. The change is an immediate
Renderer cutover.

Rollback is limited to the activity projector/components and App/Inspector
selection wiring. No Main, preload, shared IPC, or Pi host rollback is needed.

## Verification Strategy

- Pure projector tests: contiguous runs, single/repeated categories, mixed
  ordering, stable IDs under streaming, failure visibility, unknown fallback,
  and response boundaries.
- Shell-evidence tests: Markdown headings/lists/fences/links/tables; ANSI, JSON,
  logs, tabs, carriage progress, ambiguous text, truncation, and copy source.
- Component tests: category summaries, direct single rows, independent
  disclosures, Markdown/Raw switch, copy targets, status transitions, and ARIA.
- App/Inspector tests: exact selection, automatic Inspector opening, prior-tab
  preservation, live call replacement, close/focus return, and stale
  session/generation clearing.
- Existing subagent presenter/timeline tests remain the sanitization and bounds
  authority.
- Real Electron flow: repeated Bash, file/edit, one and parallel subagents,
  live Inspector timeline, session replacement while open, keyboard navigation,
  and no horizontal overflow. Capture desktop light/dark plus 1100x680.
