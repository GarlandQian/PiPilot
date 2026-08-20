# Codex-style tool activity presentation

## Goal

Redesign the expanded presentation of Bash, subagents, file operations, edits,
and generic tool calls so a response is easy to scan like Codex without copying
Codex branding or abandoning PiPilot's current visual language.

The default view should answer what happened and whether it succeeded. Exact
observable evidence such as commands, output, errors, patches, and subagent
progress remains available on demand. Transport arguments and raw nested JSON
must not dominate the conversation.

## Confirmed facts

- The supplied Codex reference groups activity at the response level, for
  example commands run, agents created, and messages sent, then reveals details
  on demand.
- PiPilot currently renders every tool turn as an independent `ToolCallCard`.
  Expanded cards may contain an outer disclosure, copy toolbar, multiple named
  sections, and nested structured-value disclosures.
- Bash transport arguments are already suppressed by the presenter. The
  visible problem is hierarchy and density rather than an argument leak alone.
- The subagent presenter already removes scheduler noise and hidden thinking,
  renders cleaned task Markdown, and projects a bounded observable execution
  timeline. This data should be reorganized, not discarded.
- Conversation response groups already exist in the Renderer and are the
  correct ownership boundary. This feature does not require Main, preload,
  utility-host, Pi SDK, or shared protocol changes.
- Existing 08-19 safety decisions remain authoritative: no hidden reasoning,
  no raw scheduler acknowledgements, bounded content, generic fallback for
  unknown tools, and raw JSONC editors in MCP/Models remain unchanged.
- The user approved the recommended response-level aggregation direction.
- The current Inspector is an App-controlled parallel surface with four
  persistent sibling tabs: Files, Changes, Conversation outline, and Terminal.
  A contextual detail route can reuse it without creating another permanent
  tab or another source of transcript truth.
- Bash detail currently sends result, progress, and error strings through
  `StructuredValueView`; only subagent task/timeline/output uses
  `MarkdownContent`. This is why Markdown-shaped Bash output remains visually
  raw.

## Requirements

### R1. Response-level activity hierarchy

- Project visible tool turns within one authoritative response group into a
  compact activity summary before rendering detailed events.
- Aggregate repeated compatible operations, such as multiple Bash commands or
  multiple subagent actions, with count and terminal status.
- Preserve chronological event order when a summary is expanded.
- Do not merge activity across response, session, scope, or runtime generation
  boundaries.
- A single operation may skip a redundant aggregate layer when direct display
  is clearer.

### R2. Bash presentation

- A Bash row shows a readable command, running/success/error state, and concise
  output evidence.
- Do not show a separate Arguments section for Bash, including cwd, timeout,
  or transport envelope fields.
- Detailed stdout/stderr stays collapsed until requested and remains bounded,
  selectable, and copyable.
- Human-readable Markdown/prose results render through the existing safe
  Markdown renderer. Commands, ANSI/log streams, JSON, and terminal-shaped
  output retain a raw monospace view so formatting cannot corrupt evidence.
- When formatted presentation is available, expose an explicit Raw view using
  the same bounded source text. Copy defaults to the source evidence rather
  than reconstructed rendered text.
- Running, cancelled, detached, failed, and completed states remain distinct.

### R3. Subagent presentation

- The collapsed row identifies the agent action, concise task summary, and
  current/terminal state without exposing the entire task prompt.
- Expanded content uses the existing observable timeline: visible assistant
  progress, tool actions, tool results, and errors in chronological order.
- Scheduler acknowledgements, fan-out bookkeeping, workflow IDs, Trellis
  wrapper text, and hidden thinking stay suppressed.
- Cleaned task Markdown and final output remain available only where useful and
  must render as Markdown rather than raw text or JSON.
- Single, parallel, and chain subagent modes must remain understandable.

### R4. Subagent contextual inspector

- Clicking a subagent activity opens the existing right Inspector as a
  contextual execution-detail surface; it does not create a second transcript
  store or read Pi directly.
- Bash, file/search, edit/patch, approval, and generic tools remain in the
  response-local inline activity region and do not take over the Inspector.
- The detail identity is the current conversation session/generation key plus
  the stable tool-call ID. A stale identity clears immediately on session,
  scope, or generation replacement.
- Opening details expands the Inspector if it is collapsed. Back/Close returns
  to the previously selected Files, Changes, Conversation outline, or Terminal
  tab and restores focus to the originating activity row when it still exists.
- The header shows the subagent/task and truthful status. The body shows the
  cleaned task Markdown, chronological observable timeline, and bounded final
  output/error evidence.
- Live updates follow the selected call without moving selection. Follow-latest
  pauses when the user scrolls away and can be resumed explicitly.
- No hidden reasoning, private scheduler state, raw workflow IDs, or guessed
  subagent actions may appear in the detail surface.

### R5. Other and unknown tools

- File reads, searches, edits, and patches use concise action-oriented rows and
  may be grouped when their semantics are compatible.
- Failures and approvals must remain prominent and must never be hidden by an
  aggregate success count.
- Unknown tools retain a bounded generic fallback and are never silently
  discarded.
- Structured-value presentation remains available for genuinely structured
  evidence but is not the default shell around every tool.

### R6. Interaction and accessibility

- Disclosures use native keyboard-accessible controls with visible focus.
- Summary and nested evidence expansion states are independent and stable.
- Copy actions copy the evidence they label, not hidden transport envelopes.
- Dynamic running status uses appropriate live semantics without repeatedly
  announcing streamed content.
- Reduced-motion, light/dark themes, Chinese/English copy, and the supported
  1100x680 minimum window are required.
- Activity rows expose `aria-expanded` where applicable. Subagent rows expose
  `aria-controls` for the contextual detail, whose navigation has an accessible
  title and Back/Close action.

### R7. PiPilot visual and architectural constraints

- Reuse current PiPilot tokens, typography, Tabler icon family, Markdown
  renderer, code renderer, and disclosure primitives.
- Keep the conversation narrative visually primary. Activity rows are quiet,
  compact evidence, not nested cards inside cards.
- Do not add gradients, glass effects, oversized cards, a new icon family, or
  a new top-level navigation surface.
- Keep the implementation Renderer-owned unless research finds an unavailable
  observable fact; do not redesign execution or protocol semantics for visual
  convenience.

## Acceptance Criteria

- [ ] One Bash call renders as a compact activity row; expansion shows command
      and bounded output without an Arguments panel.
- [ ] Markdown/prose Bash results render with headings, lists, links, and code
      through the existing Markdown renderer, while Raw preserves the exact
      bounded source; terminal/log/JSON output defaults to Raw.
- [ ] Multiple Bash calls in one response render a count/status summary and an
      ordered expandable list rather than a stack of full cards.
- [ ] A subagent call renders a concise summary and an ordered observable
      timeline, with meaningful Markdown rendered and scheduler noise hidden.
- [ ] Activating a subagent activity opens a live contextual Inspector view;
      Back/Close restores the prior Inspector tab and stale session/generation
      details never remain visible. Other tool categories remain inline.
- [ ] Parallel and chained subagent activity remains distinguishable and does
      not duplicate cumulative progress or final output.
- [ ] File, search, edit, patch, approval, failure, and unknown tool cases remain
      visible and retain their important evidence.
- [ ] Aggregation never crosses an authoritative response/session/generation
      boundary and stable identities prevent streamed updates from duplicating
      rows.
- [ ] Disclosure, copy, keyboard, focus, ARIA, reduced-motion, localization,
      light/dark, and 1100x680 behavior are verified.
- [ ] Focused projector/component tests, typecheck, build, and a real Electron
      visual workflow pass against the current worktree.

## Out of scope

- Copying Codex branding, proprietary implementation details, or mobile layout.
- Exposing hidden model reasoning or private extension scheduler data.
- Changing Pi SDK execution, utility-host protocol, or approval semantics.
- Redesigning MCP/Models raw JSONC editors.
- A broad conversation-shell or Composer redesign unrelated to tool activity.
- Replacing the existing four persistent Inspector tabs with a new navigation
  architecture.
- Opening Bash, file/search, edit/patch, approval, or generic tool details in
  the Inspector; only subagents use the contextual Inspector in this task.
