# JSON activity display cleanup

## Goal

Make every user-facing protocol/JSON-shaped value readable at a glance without
losing access to exact data when it is genuinely needed. Conversation activity
must communicate what happened, its state, and a short result instead of
presenting raw agent orchestration payloads as reasoning.

The result should also replace the current plain-text workspace file dialog
with a familiar content-aware read-only viewer. Both changes preserve
PiPilot's compact developer-tool visual language:
one concise row by default, semantic labels and status, bounded expandable
details, keyboard access, and exact copy where appropriate.

## Confirmed Facts

- `src/renderer/pi-rpc/presentation.ts` currently stringifies generic tool
  arguments with `JSON.stringify(value, null, 2)` and stores the result in the
  generic `ToolCall.body` string.
- `src/components/chat/ToolCallCard.tsx` presents those strings as raw argument,
  progress, result, and error blocks. The collapsed header may also expose the
  complete serialized argument string.
- A `subagent` call can therefore expose its full internal task prompt and
  scheduler response, including Trellis paths and instructions, as if it were
  assistant reasoning.
- Extension response activity is already projected separately and supports a
  compact collapsed row, but its details are still untyped strings and do not
  share a general structured-value presentation primitive.
- MCP and Models settings deliberately maintain one editable JSONC draft across
  Form and JSON views so comments and unknown fields are preserved. These are
  explicit advanced editing surfaces rather than passive protocol output.
- `ReadySessionOwnedTabs` currently opens every text file in a modal and renders
  it with one wrapping `<pre>`, regardless of extension. It bypasses the
  repository's existing safe Markdown pipeline and code-block controls.
- `MarkdownContent` already provides `react-markdown`, GFM, safe links/images,
  highlighted fenced code, tables, and task lists. `CodeBlock` already provides
  copy, wrapping, line numbers, bounded expansion, and reduced-motion-safe
  controls. The project has no Monaco or CodeMirror dependency.
- The renderer already uses PiPilot tokens, local UI primitives, Tabler icons,
  both locale catalogs, reduced-motion behavior, and a 1100 x 680 minimum
  window contract.

## Requirements

### R1. Shared structured-value projection

- Introduce one bounded, deterministic renderer projection for JSON-shaped
  values rather than formatting independently in each component.
- Distinguish object, array, scalar, valid JSON text, JSON-like text, and plain
  text without throwing on malformed input.
- Produce a concise semantic summary plus an exact, bounded detail
  representation. Preserve exact copy of the bounded source/value.
- Apply explicit depth, entry-count, string-length, and total-output limits.
  Circular, unsupported, or oversized input must degrade to a truthful summary.
- Do not leak prototype fields, getters, functions, class instances, internal
  renderer objects, secrets, or unbounded protocol payloads.

### R2. Conversation tool calls

- Generic tool calls show tool identity, lifecycle state, and a concise
  operation-specific summary in the collapsed row.
- Raw serialized arguments and results are hidden by default and available only
  through an explicit Details disclosure.
- The detail view groups Arguments, Progress, Result, and Error consistently,
  formats structured values for scanning, and offers exact copy actions.
- The `subagent` tool receives a dedicated presentation adapter. It shows a
  short agent/task label and queued/running/completed/failed state; it must not
  display the full delegated prompt, Trellis instructions, scheduler guidance,
  `subagent_wait` prose, workflow UUIDs, or fan-out accounting in the collapsed
  transcript.
- Background/detached subagent acknowledgement is presented as a state change,
  not as assistant reasoning or a large result block.
- Expanded subagent tasks use the existing safe Markdown renderer instead of a
  generic JSON tree. Scheduler acknowledgements remain hidden there as well;
  only meaningful progress, failure, or completed output is rendered.
- Read, edit, shell, and existing typed tool cards keep their useful specialized
  summaries while adopting the shared detail/copy treatment where structured
  payloads occur.
- Bash/shell cards show the command as their compact summary and the observable
  output/error on disclosure. They do not repeat transport arguments such as
  cwd or timeout as a generic Arguments tree.

### R3. Extension and response activity

- JSON-shaped status, widget, notification, working, retry, and extension error
  details use the same structured presentation and bounds.
- Activity remains attached to its authoritative response turn when provenance
  exists, and remains global only when unbound. This task must not reintroduce
  duplicate notification surfaces.
- Completed activity collapses automatically unless it is an error; active
  activity stays compact and understandable without expanding details.

### R4. Other passive JSON displays

- Audit all production renderer surfaces for passive raw JSON or
  `JSON.stringify` output, including dialogs, errors, diagnostics, settings
  summaries, Integration resource details, and generic fallbacks.
- Replace passive dumps with semantic key/value rows, compact summaries, or the
  shared disclosure component according to context.
- Preserve explicit Raw/JSON editing modes where exact document editing is the
  product capability. MCP and Models keep their existing editable JSONC modes.

### R5. Interaction and visual consistency

- Use one disclosure/card language matching current PiPilot conversation UI;
  no nested cards, oversized code regions, gradients, or new icon family.
- Details are closed by default, except errors may open once when first
  observed. Completion must not cause layout jumps that lose scroll position.
- Pointer and keyboard behavior must cover disclosure, section navigation, and
  copy. Icon-only controls require localized labels and tooltips.
- Long values wrap inside the middle column without page-level horizontal
  scrolling. Detail regions have stable maximum heights and internal scrolling.
- Support light/dark themes, both locales, reduced motion, and the 1100 x 680
  minimum window.

### R6. Safety and ownership

- Main/preload/shared official Pi contracts remain exact; renderer presentation
  must not mutate, reinterpret, or persist Pi-owned payloads.
- Any package-specific summary adapter is selected by exact tool identity and
  must fall back safely for unknown tools.
- User-visible labels and state copy belong in `en-US` and `zh-CN` locales.
- Existing Form/JSON single-draft behavior, secret handling, and JSONC
  preservation must not regress.

### R7. Content-aware workspace file viewer

- Replace the generic raw `<pre>` dialog with one shared read-only file viewer
  built from the existing Markdown and code presentation primitives; do not add
  a full editor dependency for a read-only workflow.
- Present the selected file as a persistent Inspector detail surface replacing
  the file tree until Back/Close. Do not use a centered modal for normal file
  browsing.
- Markdown files render a safe formatted Preview by default and provide a
  Preview/Source segmented control. Source uses syntax highlighting, line
  numbers, wrap, and copy.
- JSON/JSONC, TypeScript/JavaScript, CSS, HTML, shell, YAML, TOML, Swift, Python,
  Rust, and other recognized text extensions open as highlighted source with a
  language label, line numbers, wrap control, and whole-file copy.
- Unknown text opens in a truthful plain-text source mode. Binary and oversized
  responses retain explicit non-previewable states.
- The viewer header shows a bounded relative path, file type, byte size, and
  close action without exposing an unrelated absolute path.
- The file content owns one stable scrolling region, stays inside the viewport,
  and must not create document-level horizontal scrolling.
- Reuse the current workspace preview IPC, containment checks, byte limits,
  stale-request epochs, and read-only contract. This task must not add file
  editing or filesystem access to the renderer.
- The selected file and mode are reset on workspace/session ownership change;
  late responses must not replace the current preview.

## Acceptance Criteria

- [x] A realistic `subagent` call matching the reported screenshot renders one
      compact row with agent/task summary and state; cleaned task Markdown
      appears only after the user explicitly opens details, while internal
      scheduler acknowledgements, workflow IDs, and the leading active-task
      routing line never render as user-facing task or result content.
- [x] When `pi-subagents` reports cumulative result messages, expanded details
      show a bounded ordered timeline of observable tool actions, progress,
      results, and errors. Repeated updates merge by stable identity and never
      expose thinking content.
- [x] Completed, running, failed, detached, and malformed `subagent` payloads
      each have truthful bounded presentation and do not masquerade as thinking.
- [x] Generic nested object/array arguments and results render a compact summary,
      readable expanded structure, and an exact copy action without horizontal
      page overflow.
- [x] Plain text, invalid JSON-like text, empty values, deep/large values, and
      circular/unsupported values degrade without crashes or misleading output.
- [x] Read/edit/shell/tool cards and response-bound extension activity retain
      their current status semantics and provenance.
- [x] Bash/shell cards retain the command and output but do not render or copy
      the redundant generic Arguments section.
- [x] A repository-wide production renderer scan finds no remaining accidental
      passive raw JSON dump outside the explicitly approved Raw/JSON editors.
- [x] MCP and Models Form/JSON drafts preserve comments, unknown fields, and
      write-only secret behavior.
- [x] Opening a Markdown file shows rendered GFM by default, with a keyboard-
      accessible Preview/Source toggle; Source uses the shared highlighted code
      viewer rather than a plain `<pre>`.
- [x] Opening representative code, JSONC, unknown text, binary, and oversized
      files produces the correct content-aware mode and read-only state.
- [x] The file viewer has one stable internal scroll area, readable header
      metadata, exact copy, no stale file flash, and no page-level horizontal
      overflow at 1100 x 680.
- [x] Focused unit tests cover the structured projector, subagent adapter,
      disclosure/copy state, bounds, and malformed inputs.
- [x] Real Electron verification covers running and completed tool activity at
      1440 x 900 and 1100 x 680 in light and dark themes, with no document-level
      horizontal overflow.
- [x] Typecheck, production build, relevant unit tests, and the affected
      Electron workflow pass on the final worktree.

## Out of Scope

- Changing official Pi SDK/RPC schemas or persisting a new transcript format.
- Exposing hidden chain-of-thought or fabricating a reasoning summary from
  internal data.
- Replacing MCP/Models structured forms or their explicit raw JSONC editor, or
  weakening JSONC validation,
  fingerprint conflict detection, or secret redaction.
- Adding package-specific controls unrelated to presenting tool/activity data.
- Redesigning the entire conversation surface or settings information
  architecture.

## Resolved Product Decisions

- MCP/Models explicit `JSON` tabs remain exact editable JSONC modes. This follows
  the existing product requirement to preserve JSON editing for advanced and
  unknown fields. Passive JSON output elsewhere is summarized by default.
- Workspace files open in a persistent Inspector detail surface. Back/Close
  restores the file tree. This follows familiar desktop developer-tool
  navigation, preserves chat context, and removes the current oversized modal.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
