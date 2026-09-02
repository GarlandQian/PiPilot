# Global UX Redesign Design

## Decision Summary

PiPilot will use a conversation-first application model with two workspaces:

1. **Conversation workspace**: a contextual Session panel, the active
   conversation, and an optional Inspector.
2. **Settings and management workspace**: grouped navigation and a focused
   detail surface. The conversation remains mounted but hidden and inert so
   returning does not lose live output, draft content, scroll, or Inspector
   context.

The navigation rail remains compact and uses the existing PiPilot tokens and
Tabler icons. Its destinations are Conversations and Settings.
Integrations moves under Settings and remains directly reachable from the
command palette.

## Goals

- Make the selected conversation and live agent work the product's visual and
  interaction center.
- Let users identify running, queued, waiting, completed, failed, and unread
  sessions without opening each one.
- Present reasoning, tools, Bash, subagents, errors, and extension activity as
  a readable execution timeline rather than raw protocol output.
- Keep the Composer predictable across idle, streaming, queue, steer, error,
  image, command, skill, and mention states.
- Give configuration workflows enough width and a clear progression from
  overview to edit/test/apply to advanced raw data.
- Preserve the current restrained desktop-tool visual language and existing
  Main/preload/Renderer ownership.

## Non-Goals

- Replacing the Pi Runtime, official session catalog, or existing runtime
  adapters.
- Moving authoritative Runtime state into React components.
- Inventing extension capabilities that are not available through the current
  Pi projections.
- Introducing a new icon family, design library, editor library, decorative
  theme, or marketing-style surface.
- Maintaining the duplicate Integrations destination or the current four-panel
  composition inside settings.

## Information Architecture

### Primary destinations

| Destination | Context panel | Main surface | Inspector |
| --- | --- | --- | --- |
| Conversations | Projects, sessions, recent work | Selected conversation | Files, Changes, Outline, Terminal, contextual subagent detail |
| Settings | Grouped settings and management navigation | Focused settings detail | Hidden |

Running, waiting, completed, and failed status is projected directly onto the
owning Session row. Sessions released from memory remain in the catalog and are
shown without a running indicator; no separate Activity inventory is created.

### Settings groups

The focused management workspace has four stable groups:

- **Preferences**: General, Appearance, Language, Composer, Terminal.
- **Models and Runtime**: model selection, custom providers, model definitions,
  connection tests, and runtime diagnostics relevant to model use.
- **Packages and MCP**: package overview, packages, resources, MCP, and External
  Control.
- **About**: version, update, diagnostics, and application information.

Common workflows use structured forms and lists. Raw JSON/JSONC remains an
explicit advanced view where it already represents a supported escape hatch.
The command palette deep-links directly to every leaf route.

### Route model

The Renderer should use one discriminated navigation model rather than
independent rail, settings-section, and integrations-tab state:

```ts
type AppRoute =
  | { workspace: 'conversation'; context: 'sessions' }
  | { workspace: 'settings'; section: SettingsRouteId }
```

This model is Renderer-owned navigation state. It must not be written into Pi
session data. Obsolete or unknown persisted destinations fall back to
Conversations. Panel visibility and width preferences remain separate from
the route and are clamped to the active layout mode.

## Frame Composition

### Wide conversation mode

At widths that can satisfy all minimum tracks, render:

`48px navigation rail | resizable context panel | conversation | resizable Inspector`

- Context panel target range: 240-320px.
- Conversation is the flexible primary track and must retain at least 560px.
- Inspector target range: 320-480px.
- Resize handles use the existing `PanelResizeHandle` behavior and accessible
  labels.
- Collapsing context or Inspector restores more width to conversation without
  changing route or selection.

The implementation should switch mode based on the available app-frame width,
not browser user-agent or operating system. A practical initial boundary is
1280px, but track minimums and Electron screenshots are authoritative; adjust
the boundary if the real composition cannot satisfy them.

### Compact conversation mode

At the supported 1100x680 minimum:

`48px navigation rail | contextual Session panel | conversation`

- The Inspector is an on-demand right detail layer with a stable width, close
  button, Escape handling, focus return, and no page-level horizontal scroll.
- Opening the Inspector does not resize the conversation into a narrow strip.
- Context panel collapse remains available through the existing rail action.
- A contextual Inspector selection, such as a subagent, opens the detail layer
  directly and exposes a Back action to the prior Inspector tab.

### Settings mode

Settings renders:

`48px navigation rail | grouped settings navigation | settings detail`

- The conversation Inspector and both of its resize controls are absent.
- The detail surface uses the freed width; list/detail editors may be side by
  side only when their minimum tracks fit.
- At compact width, settings use a drill-in pattern: group/list first, detail
  second, with a visible Back action and preserved scroll/selection.
- Settings content must never solve width pressure by wrapping paths or labels
  one character per line.

## Mounted Conversation Contract

Changing to Settings changes visibility, not Runtime ownership.

- The active conversation, transcript subscription, running generation,
  Composer draft, attachments, pending queue, selected model/thinking level,
  transcript scroll anchor, collapsed execution details, selected Inspector
  tab, Inspector detail stack, and panel widths survive the route change.
- The hidden conversation tree is inert: it must not be tabbable or announced
  by assistive technology while Settings is active.
- Returning to Conversations restores the exact prior conversation workspace
  without re-opening the Session or replacing its generation.
- Settings must not trigger Runtime allocation merely because a route or
  package page reads catalog data.

## Session Selection And Status

### Selection state machine

The central conversation and all session-bound Inspector surfaces use one
selection generation and expose four states:

- `empty`: no selected Session; no prior transcript or Inspector data.
- `loading`: target Session is selected and hydrating; both conversation and
  session-bound Inspector show centered loading for that target.
- `ready`: transcript and matching Inspector projections have completed
  hydration for the current selection generation.
- `error`: the selected target failed to open; show an inline retry and useful
  error while suppressing previous Session data.

Rapid switching is latest-selection-wins. Older hydrations may finish, but
their generation cannot publish into the visible conversation or Inspector.
The loading state remains until full hydration, preventing an empty-state
flash followed by content.

### Session row state

Rows have a stable leading identity and a compact trailing state. Visual state
is derived from existing catalog/runtime projections, not local timers:

- Running: animated but reduced-motion-safe activity indicator.
- Queued or waiting: distinct waiting indicator and accessible label.
- Needs attention or failed: restrained error/attention treatment.
- Completed: completion mark until acknowledged or superseded by later work.
- Unread update: subtle dot independent of selected state.
- Loading: only the row currently being opened displays hydration progress.
- Released Runtime: no activity icon; the persisted row remains selectable.

## Conversation Timeline

### Turn hierarchy

Each turn is a semantic unit:

1. User prompt with attachments and a restrained message surface.
2. Assistant response as unframed readable prose.
3. Execution timeline interleaved at the point events occurred.
4. Per-response actions after completion.

Notifications, retry information, queue/steer acknowledgements, and extension
messages that belong to a response stay inside that turn. The global
notification surface is reserved for application-level events such as update
availability or a package operation not owned by a conversation.

### Streaming and reasoning

- Only live assistant text uses the existing typewriter projection. Hydrated
  history renders immediately.
- Streaming appends must preserve Markdown block integrity and avoid replaying
  already rendered characters after selection or route changes.
- Live reasoning expands while it is actively receiving content. On normal
  completion it collapses to a one-line summary with status and duration.
- A manual user toggle overrides automatic collapse for that reasoning item.
- Reduced motion keeps the same state changes without animated expansion or
  character transitions.

### Tool, Bash, and subagent activity

- Collapsed rows show a familiar icon, human-readable action, concise target,
  duration when available, and running/completed/failed status.
- Tool-specific presenters remain authoritative. Generic values use
  `StructuredValueView`; raw object stringification is not a primary UI.
- Bash summaries show the command or intent, not a duplicate JSON argument
  block. Expanded stdout/stderr uses terminal/code presentation rather than
  Markdown rendering.
- Textual tool results that are documented as Markdown use the shared Markdown
  renderer. JSON and structured results stay structured.
- Subagent calls show an ordered progress summary in the turn. Selecting one
  opens `SubagentExecutionPanel` in the Inspector, where its progress, tools,
  messages, result, and error are shown without exposing raw RPC envelopes.
- Truncated payloads state why they are bounded and offer the supported detail
  path; they must not silently end mid-document.

## Composer

The Composer remains one stable shell aligned to the conversation measure.

- The editor is the primary visual element. Attachment and command controls
  stay secondary; model and thinking controls use the existing compact control
  language.
- `/` opens one full-width picker containing Commands and Skills in grouped
  sections. `@` opens the same picker recipe containing Files and Skills.
- Pickers align to the full Composer width, open adjacent to it, and support
  Up/Down, Home/End, Enter, Tab where appropriate, Escape, mouse, empty,
  loading, and error states without losing editor focus.
- Right-clicking an Inspector file and choosing the existing reference action
  inserts the same semantic mention as the `@` picker.
- Idle mode exposes Send. Running mode clearly distinguishes Stop from adding a
  follow-up. Queue and Steer are explicit modes; a queued item can be promoted
  to Steer without retyping it.
- Draft text, file mentions, and image attachments are preserved when queuing,
  steering, switching Session, opening Settings, or encountering a recoverable
  send error.
- Client submission validation rejects a truly empty payload before calling
  Pi, but allows a supported attachment-only prompt. The UI never manufactures
  an empty text content part.
- The configured Enter or Ctrl+Enter send preference is shown through behavior
  and accessible labels, not permanent instructional copy.

## Inspector

The Inspector keeps the existing domain tabs: Files, Changes, Conversation
Outline, and Terminal.

- **Files**: searchable tree, stable material file icons, readable preview or
  source mode, context-menu reference insertion, and explicit binary/large/
  unavailable states.
- **Changes**: one continuously scrollable diff surface; large files load
  independently and preserve scroll as additional files resolve.
- **Outline**: newest relevant conversation items are easy to locate; selecting
  an item navigates the transcript using the existing jump request contract.
- **Terminal**: preserves its live terminal ownership and typography settings;
  switching tabs does not recreate the terminal process unnecessarily.
- **Contextual detail**: subagent detail is a pushed Inspector state with Back,
  not a new top-level tab. Closing it restores the prior tab and scroll.

No selected Session means session-bound tabs show a centered neutral empty
state and never data from the last Session. Loading uses the same selection
generation as the conversation.

## Settings And Management

### Common workflow

Every configurable resource follows the same progression:

`browse/select -> inspect -> edit/test -> save/apply -> inline result`

- List rows use stable dimensions and visible selected, disabled, loading, and
  error states.
- Common fields are structured. Advanced data is behind a clearly named Raw
  JSON/JSONC view and preserves unknown supported fields.
- Validation errors sit beside their field and use `aria-describedby`.
- Save/test/install/reload results are inline and non-blocking unless a
  destructive confirmation is required.
- Paths are presented with the existing cross-platform path formatter; full
  resolved paths remain available where required for editing or diagnosis.

### Models and providers

- Provider rows own their models and expose Add, Edit, Duplicate, Test, and
  Delete through predictable actions.
- API type is a Select backed by the supported schema, with an advanced path
  only for fields that cannot be represented safely.
- Model rows show display name, model id, capabilities, context/output limits,
  default state, and a compact action menu without duplicating the same model
  inventory above the editor.
- Test shows pending, success, transport error, authentication error, and
  response-format error near the tested provider/model.

### Packages, resources, MCP, and external control

- Overview is a concise problem/action summary, not a large compatibility
  matrix.
- Package rows distinguish installed, update available, reload required,
  incompatible, and unavailable states using the shared status recipe.
- Package-specific adapters remain implementation details; diagnostics explain
  actionable incompatibility without exposing raw bridge records.
- MCP offers a structured server list and form plus Raw JSONC. Scope and path
  labels use existing global/project presentation rules.
- Runtime Reload is attempted after supported package changes; Host restart is
  the fallback and must say what will continue or stop.
- External Control uses the same management recipe and keeps local transport
  details understandable without platform-specific UI branches.

## Visual Language And Reuse

- Continue using `src/styles/globals.css` semantic tokens, current font stack,
  compact control heights, hairline borders, moderate radii, and the single
  sage accent.
- Use existing primitives from `src/components/ui/` and Tabler icons from
  `react-icons/tb`.
- Extend the existing `ContextPanel`, `SessionsPanel`, `SessionList`,
  `MessageList`, `Composer`, `ToolCallCard`, `StructuredValueView`,
  `InspectorPanel`, `SettingsLayout`, and settings form recipes before adding
  abstractions.
- Do not put cards inside cards. Page regions remain unframed; cards are for
  repeated resources, dialogs, or genuinely bounded tools.
- Empty, loading, and error states use the same compact typography and centered
  placement recipe. They do not shift panel dimensions.
- User-visible strings are added to both locale files; icon-only controls have
  `aria-label` and unfamiliar icons have tooltips.

## State Ownership And Data Flow

The redesign consumes existing owners:

- `useWorkspaceStore`: projects, official Session catalog, selection, catalog
  mutations, and workspace files.
- `usePiRuntime`: active Runtime state, models, commands, queue, retry, and
  streaming status.
- `usePiTranscript`: projected turns, outline, and revision.
- `usePiRpcActions`: command operations.
- `usePiExtensionUi`: plan, goal, retry, working messages, dialogs, and
  extension surfaces.

New status and presentation models are pure Renderer projections over these
sources. They must be deterministic, testable outside React, and keyed by
stable scope/selection/generation ids. React owns only navigation, panel,
selection-detail, and user-expansion preferences.

No Main/preload/Host contract change is expected. If implementation discovers
that a required status is absent, it must first document the exact missing
authoritative field and add a bounded shared DTO/schema rather than infer it
from label text or elapsed time.

## Accessibility, Localization, And Motion

- Rail, context navigation, tabs, lists, dialogs, pickers, and detail layers
  use semantic roles and predictable tab order.
- Moving between workspace, contextual navigation, and Inspector returns focus
  to the initiating control when closed.
- Status is conveyed by text/accessible name as well as color or animation.
- All new copy is present in `en-US` and `zh-CN`; layouts are tested with both.
- Reduced motion removes typewriter animation, spinner rotation where a static
  progress label suffices, and panel transitions while preserving feedback.

## Migration And Rollback

- This is a direct UI replacement; no feature flag or duplicate legacy frame
  is kept.
- Unknown/obsolete persisted rail destinations fall back to Conversations.
  Existing panel widths and open/closed preferences are retained where their
  meaning still exists and clamped to the new track constraints.
- Pi config, Session files, package state, model files, and MCP files are not
  migrated by this task.
- Each implementation phase ends with focused tests and a reviewable UI state.
  A failing phase can be reverted without reverting prior state/data fixes.

## Verification Strategy

### Automated

- Unit-test route normalization, Session status projection and mapping,
  latest-selection-wins presentation, Composer picker/submission behavior,
  detail-stack behavior, and structured settings view models.
- Extend Electron tests for workspace switching, loading-to-ready transitions,
  concurrent running Sessions, Settings round-trip state restoration, compact
  Inspector, Composer keyboard operation, subagent detail, file reference
  insertion, model/provider workflows, MCP validation, and destructive states.
- Keep current integration and packaged tests passing; packaging behavior is
  outside the redesign unless a real regression is found.

### Visual

Build the current worktree and inspect the real Electron application at:

- 1440x900 light and dark conversation workspace.
- 1100x680 light and dark conversation workspace.
- Empty, loading, ready, streaming, failed, queue/steer, and concurrent-session
  states.
- `/` and `@` pickers, images, reasoning, tool/Bash/subagent activity.
- Files, continuous Changes, Outline, Terminal, and compact detail layer.
- Settings overview, Models, Packages, MCP structured/raw, error, and narrow
  drill-in states.

Candidate screenshots are review evidence. Only user-confirmed, current-
worktree captures may replace `pipilot-ui-style` reference assets.
