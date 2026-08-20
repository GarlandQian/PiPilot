# Polish MCP and session runtime UX

## Goal

Deliver a coherent Electron-only experience for Pi packages and resources, MCP
configuration, session-owned inspector data, optional rich plugin activity, and
first-session activation. The UI should borrow Codex's approachable
configuration and activity patterns while continuing to use the selected local
Pi installation, Pi's official package/runtime APIs, and PiPilot's existing
exact-file MCP configuration service. Package-specific rich UI is limited to
Plan Mode and Retry because those are the only evaluated integrations whose
required state and actions cross the current official Pi RPC boundary.

## Confirmed Context

- Codex desktop presents MCP as a server list with an Add server flow, explicit
  STDIO or Streamable HTTP transport fields, enable/authentication status, and a
  restart after changes. Codex stores its own configuration in TOML; PiPilot
  must keep Pi's JSON/JSONC files and must not copy Codex's storage format.
- PiPilot already supports structured and raw JSONC editing for global
  `~/.pi/agent/mcp.json` and selected-project `.mcp.json`, including comments,
  unknown fields, optimistic conflict detection, and controlled Pi restart
  (`src/components/settings/McpSettings.tsx:221`).
- The current inspector fetches Files and Changes whenever a workspace is
  available, even when no Pi session is selected. Only the Pi Session panel is
  currently gated by conversation state, which allows stale data to remain in
  the other tabs (`src/components/inspector/InspectorPanel.tsx:74`,
  `src/components/inspector/InspectorPanel.tsx:147`).
- Pi 0.84.1 publicly exports `DefaultPackageManager` and `SettingsManager`. The
  official package manager resolves global/project packages and their enabled
  Extensions, Skills, Prompts, and Themes; it also provides install, remove,
  update, list, and progress APIs. Pi's package filter object is the canonical
  per-resource enable/disable format.
- Official Pi RPC already exposes extension commands and Skill commands through
  `get_commands`, all tool execution events/results, and the extension UI
  dialog/status/widget/notification protocol. TUI-only surfaces such as
  `ui.custom()`, custom footer/header/editor components, raw shortcuts, themes,
  and custom terminal renderers cannot be reproduced automatically in RPC mode.
- PiPilot already hosts official extension dialogs, notifications, status text,
  string widgets, title changes, and editor-text replacement
  (`src/components/chat/ExtensionUiDialog.tsx:30`,
  `src/components/chat/ExtensionSurfaces.tsx:6`, `src/App.tsx:537`). The current
  widget host renders raw monospaced blocks and the generic tool projector maps
  every unknown tool to a shell card (`src/components/chat/ExtensionSurfaces.tsx:45`,
  `src/renderer/pi-rpc/presentation.ts:26`), so the generic GUI needs refinement
  before package-specific adapters are added.
- The currently configured Pi packages span all of those categories. Memory,
  MCP, LSP, goal, retry, and tool extensions mostly use RPC-compatible hooks,
  commands, tools, and status updates. `pi-subagents` loses its component-based
  FleetView; `pi-btw` depends heavily on `ui.custom()`; `pi-starship`,
  `pi-pretty`, `pi-diff`, and `pi-themes-bundle` are primarily TUI presentation;
  `pi-worktree` can replace the active cwd/session and therefore conflicts with
  PiPilot's selected-project scope unless explicitly integrated.
- The installed optional extension is `pi-subagents@0.44.0`. Pi core does not
  provide built-in subagents. The extension exposes structured `subagent` tool
  results through ordinary Pi RPC, but its versioned activity/control protocol
  is carried only on Pi's in-process extension event bus. Pi 0.84.1 JSONL RPC
  has no command for sending arbitrary extension events, so PiPilot cannot use
  that protocol without a non-official bridge.
- Real Pi sessions can contain very deep history trees. A previously observed
  session contained 1,762 nested nodes. Iterative validation and rendering fixed
  the JavaScript stack overflow, but sending a deeply nested result through
  Electron IPC can still fail structured cloning with `An object could not be
  cloned.` The current command handler returns the validated recursive response
  directly (`src/shared/local-pi.ts:533`, `src/shared/local-pi.ts:703`,
  `src/main/ipc/register-local-pi-ipc.ts:237`).
- Coalescing concurrent renderer catalog refreshes fixed one refresh race, but
  the first real session activation can still produce enough legitimate
  lifecycle invalidations to exhaust the catalog's fixed retry window and show
  `The session catalog changed during refresh.` after the session has already
  loaded (`src/main/conversations/official-pi-session-catalog.ts:837`,
  `src/main/conversations/official-pi-session-catalog.ts:844`,
  `src/store/workspace.tsx:570`).
- macOS `TSM AdjustCapsLockLED...` and `IMKCFRunLoopWakeUpReliable` lines are
  operating-system input-method diagnostics. They are not PiPilot operation
  failures and are outside this task.
- Composer candidate navigation is only partially explicit today. The `@`
  Files/Skills picker and the first `/` command level keep a controlled active
  item and intercept Arrow keys in `Composer`, while the nested `/skills`
  search delegates selection entirely to `cmdk`. Existing Electron coverage
  validates clicks and ARIA linkage but does not prove a complete keyboard-only
  selection flow across either picker (`src/components/chat/Composer.tsx:619`,
  `src/components/chat/Composer.tsx:748`,
  `src/components/chat/SkillPicker.tsx:207`,
  `tests/electron/pipilot.electron.spec.ts:220`).
- Extension notifications are currently positioned against the entire browser
  window with `fixed right-3 top-14`, and `App` mounts them outside the
  sidebar/conversation/inspector layout. Opening or resizing the inspector does
  not keep them inside the middle conversation column
  (`src/components/chat/ExtensionSurfaces.tsx:15`, `src/App.tsx:589`).
- The current candidate surfaces do not share a Codex-like visual hierarchy.
  `/skills` uses a Popover with a separate title row and nested search input,
  while `@` uses a portal with a repeated query header and grouped results.
  Their width, focus ownership, active-item state, and empty/loading treatment
  therefore feel like separate tools rather than one composer interaction
  (`src/components/chat/SkillPicker.tsx:147`,
  `src/components/chat/ComposerMentionPicker.tsx:161`).
- The installed Retry extension is `@narumitw/pi-retry@0.31.0`. It does not own a
  retry loop: it classifies additional provider errors, detects stalled streams,
  and lets Pi's built-in retry engine perform attempts and backoff. PiPilot
  already projects official attempt/delay/error events, but only exposes an
  `retryActive` boolean, leaves `retryMessage` unused, and presents separate
  Enable and Disable menu commands without an authoritative displayed value.
- The current Retry controls can diverge from the extension. PiPilot's
  `set_auto_retry` changes the running Pi process, whereas `pi-retry` reads the
  persisted Pi retry setting through `SettingsManager` at session start and
  before provider requests. A correct adapter must update both through official
  Pi APIs and report partial failure rather than pretending the states match.

## Requirements

### Pi integrations manager

- Add a first-class Integrations area in Settings. It is organized around Pi's
  package/resource model rather than a hard-coded settings page for every npm
  package.
- The overview lists configured global and selected-project packages with
  source, installed version when available, pinned/unpinned state, scope,
  resource types, pending restart state, and last operation/error.
- Install accepts the source formats supported by Pi (`npm:`, `git:`, URL, or
  local path) and an explicit global/project scope. Update and remove operate on
  the same selected local Pi installation.
- Package discovery, install, remove, update, resource resolution, and package
  persistence must delegate to the matching local Pi version's public package
  manager/SettingsManager. PiPilot must not implement a second npm/git package
  manager, parse human CLI output, or rewrite package settings with ad hoc JSON
  mutations.
- Expose official operation progress in a bounded UI and serialize mutations so
  install/update/remove cannot race each other or a Pi restart.
- After a package change, show that restart is required and offer a
  controlled restart. Successful restart refreshes commands, Skills, extension
  surfaces, and compatibility observations before clearing the pending state.
- Provide searchable resource views for resolved Extensions and Skills, showing
  package/source, global/project scope, enabled/inherited/disabled state, and
  any official load diagnostic. These effective resource states are read-only
  in this release because Pi 0.84.1 exposes filter resolution but no public
  non-interactive single-resource mutation API; PiPilot must not reproduce the
  private `pi config` filtering algorithm.
- List Prompt Templates and Themes in the same resource model. Themes and other
  TUI-only resources remain visible because PiPilot manages the user's complete
  local Pi installation, but they must be labeled as affecting Pi TUI rather
  than PiPilot's Electron appearance.
- A package stays manageable even when none of its runtime UI is compatible
  with Electron RPC. Installation state and runtime compatibility are separate
  concepts.
- Do not label a package fully compatible based only on installation. Derive
  observed RPC surfaces from official commands, tool events, extension UI
  events, and extension errors; use an explicit curated/capability adapter only
  for richer semantics that official generic RPC cannot express.
- Package details explain which surfaces are automatic, degraded, TUI-only, or
  provided by an optional rich adapter. Unknown packages remain installable and
  usable through generic official RPC behavior.

### Integrations settings GUI

- Replace the standalone MCP navigation item with one Integrations section.
  Keep General, Models, Terminal, Appearance, Language, and About unchanged.
- Integrations uses a quiet list/detail workspace rather than nested cards:
  a searchable package/resource list, a persistent detail pane on wide windows,
  and a drill-in detail screen with Back navigation on narrow windows.
- The section header contains the selected local Pi version/path, a
  Global/Project segmented scope control, an Add button, and a restart-required
  indicator. Scope changes never silently discard pending edits.
- Primary views are Overview, Packages, MCP, and Resources. Resources has
  filters for Extensions, Skills, Prompt Templates, and Themes; it does not add
  four more top-level Settings navigation items.
- Package rows show name/source, installed version, scope, update/pin state,
  resource counts, and one concise compatibility label. Row actions use a
  familiar overflow menu for Update, inspect Resources, and Remove.
- Package details show contained resources and their effective state, including
  inherited global resources overridden by project filters. They also show
  observed commands/status/widgets/errors after the most recent Pi restart.
- Add Package is a focused dialog with source, Global/Project scope, and an
  install action. Manual npm/git/URL/local sources are in scope; an online
  marketplace/search gallery remains out of scope.
- MCP uses a server list plus an Add/Edit detail form modeled after Codex. Raw
  JSON remains an Advanced tab for the selected scope and uses the same dirty,
  conflict, save, and restart state as structured editing.
- Skills show name, description, invocation (`/skill:name`), source/scope, and
  enabled state. Extensions show source path/package and runtime surfaces but do
  not invent configuration fields that the package does not declare.
- Themes show their Pi TUI target explicitly and are never offered as PiPilot
  Electron themes. Prompt Templates show their slash invocation and source.
- Install/update/remove progress is inline in the affected row and in a
  compact operation status area; normal success does not open a modal.
- Empty, loading, partial-error, restart-required, and unavailable-local-Pi
  states are designed explicitly. Lists keep stable dimensions and long package
  names/source URLs truncate without resizing controls.

### Codex-inspired MCP settings

- Make the default MCP settings view a scannable server list rather than an
  always-open dense form.
- Show each server's name, transport, enabled state, configuration scope, and
  actionable adapter/authentication or validation state without exposing
  secrets in the list.
- Provide an Add server action that asks for name and transport first, then
  shows the applicable STDIO command/arguments/environment fields or HTTP URL
  and header fields.
- Selecting a server opens the same form for editing; adding and editing must
  continue to use the existing parsed JSONC document and fingerprint-based save
  flow.
- Retain global/project scope selection and show the exact managed path.
- Retain Raw JSON as an explicit advanced editing mode. Switching between form
  and raw modes must preserve comments and unknown fields according to the
  existing parser contract.
- Keep Save and Save + Restart Pi explicit. Do not imply that Pi core contains
  MCP support when the optional adapter is absent; explain the adapter state in
  the settings UI.

### Composer candidate keyboard navigation

- The grouped `/` Commands/Skills menu and grouped `@` Files/Skills menu must
  both be fully usable without a pointer.
- `ArrowDown` selects the next enabled visible candidate and `ArrowUp` selects
  the previous one in the exact rendered order. When no candidate is active,
  Down starts at the first candidate and Up starts at the last; movement wraps
  at the boundaries, matching the existing top-level composer behavior.
- Group headings, loading/empty/error messages, truncation notices, and disabled
  conflict rows are never keyboard targets. In the `@` menu, navigation crosses
  the Files/Skills group boundary as one ordered candidate list.
- The active row uses the same visual state for keyboard and pointer movement,
  remains scrolled into view, and exposes an `aria-activedescendant` that points
  to a real rendered option. If filtering or an asynchronous catalog/path result
  removes the active row, selection moves deterministically to the first
  remaining enabled candidate; when none remain, the active descendant clears.
- `Enter` invokes only the active candidate. In `/` it inserts the selected
  official command or Skill directly; in `@` it inserts the selected file,
  directory, or Skill atom. Enter with no selectable row does not submit or
  insert a stale candidate.
- `Escape` closes the active `/` or `@` surface without an intermediate Back
  step and retains the current typed editor text.
- IME composition and key code 229 never move or activate a candidate. Scope,
  session, runtime generation, or command-catalog replacement closes stale
  menus and clears their active selection.

### Codex-style Composer candidate surfaces

- `/` and `@` use one shared compact picker shell anchored to the composer. They
  share width, corner radius, border, shadow, row height, loading/empty/error
  treatment, active-row color, and scrolling behavior.
- The picker opens immediately above the composer without covering the current
  insertion point or changing the composer height. It remains aligned to the
  composer on sidebar/inspector resize and is constrained to the middle column
  on narrow windows.
- The surface is a dense command/file list, not a dialog and not a stack of
  cards. Rows use the existing Tabler icon family, a concise primary label, one
  optional muted description/path line, and right-aligned scope/source metadata
  only where it helps distinguish duplicate resources.
- The `/` view reads its query from the editor and directly renders Commands and
  installed Skills as light section labels in one scrollable list. It has no
  `/skills` navigation row, second screen, Back control, or separate Skill query
  field. Filtering applies to both groups and keeps their rendered order.
- The `@` view reads its query from the editor and does not repeat `@query` in a
  decorative header. It shows Files and Skills as light section labels in one
  scrollable list, omits empty sections unless their loading/error state is
  actionable, and preserves the exact file/Skill identity used by submission.
- Remove the toolbar `@` button and its tooltip. Direct typing is the only entry
  point for `@`; no empty synthetic trigger is inserted by a button, and opening
  the picker never replaces a selected text range. Image/file attachment remains
  a separate paperclip action and is not part of this removal.
- At most one compact status row is shown for a source that is loading, empty,
  unavailable, or failed. Status rows never become selected options and an
  error in one source does not hide valid candidates from the other source.
- Long file paths, package names, and Skill descriptions truncate within stable
  row dimensions. The active row stays visibly highlighted for both pointer and
  keyboard interaction; pointer hover updates the same controlled selection.
- Opening, filtering, selecting, dismissing, scope replacement, and asynchronous
  candidate refresh must not move text, duplicate triggers, or restore a stale
  file/Skill identity.

### Conversation-column extension notifications

- Extension notifications are anchored to the upper-right of the middle
  conversation column, immediately below the chat header, rather than to the
  application window or inspector edge.
- The notification host lives inside the conversation layout's positioning
  context and follows the middle column when the sidebar or inspector opens,
  closes, or resizes. It never renders over the sidebar or inspector.
- Notifications form a bounded-width vertical stack above transcript content.
  They remain pointer-transparent outside their own surfaces, keep the existing
  info/warning/error semantics and dismiss action, and sit below dialogs and
  composer candidate popovers in the layer order.
- On a narrow middle column, each notification shrinks to the available width
  with consistent insets and wrapped text. It must not cover chat-header actions
  or resize the transcript/composer layout.
- No-session, session-loading, scope replacement, and runtime-generation changes
  clear or hide notifications from the prior conversation exactly as the
  existing conversation readiness gate requires.

### Pi Retry and pi-retry adaptation

- Pi's official retry engine remains the sole owner of attempt count, retry
  budget, exponential delay, continuation, and cancellation. PiPilot and
  `@narumitw/pi-retry` must not introduce a second scheduler or timer-driven
  retry loop.
- Detect `@narumitw/pi-retry` through the selected local Pi package manager and
  show its exact installed version and compatibility state in Integrations.
  Without the extension, the ordinary Pi retry UI still works; with a supported
  extension version, the UI additionally identifies enhanced provider-error
  classification and stalled-stream recovery.
- Replace the header menu's simultaneous Enable and Disable actions with one
  authoritative retry setting. Persist `retry.enabled` through the matching
  local Pi `SettingsManager`, flush and surface write errors, then synchronize
  the active RPC process with official `set_auto_retry`. Never mutate Pi's JSON
  through an ad hoc parser.
- Show the effective `enabled`, `maxRetries`, and `baseDelayMs` values from Pi's
  official settings. Values without a public official setter remain read-only
  unless edited through an existing raw advanced settings path; PiPilot does not
  invent a second retry configuration file.
- During an official `auto_retry_start`, render a compact activity block directly
  above the composer with attempt/max attempts, a live delay countdown, a
  bounded readable error reason, and Stop. At the end of the delay it changes to
  Retrying without claiming that another attempt has started before Pi reports
  settlement.
- `abort_retry` is available only while Pi reports a cancellable retry delay. A
  successful abort settles the block; late events from the cancelled generation
  cannot reactivate it.
- `auto_retry_end` shows a short recovered state on success. Final failure shows
  the attempt count and bounded final error inline and continues through the
  normal transcript/error projection without an extra global modal.
- When the supported extension publishes status key `retry`, its `receiving` and
  `retrying` values may enrich the same activity block under a strict
  package/version/value gate. Unknown values and unsupported versions stay in
  the generic extension activity surface; notification prose and injected error
  strings are never parsed as an adapter protocol.
- Retry state is keyed by conversation scope, official session identity, and
  runtime generation. No-session, session switch, runtime replacement, or
  settlement clears countdown timers and prior retry reasons immediately.
- Summarization retry remains a distinct official state. It uses the same visual
  language but is labeled as compaction/branch-summary recovery and never shown
  as a provider retry from `pi-retry`.

### RPC-complete rich adapter scope

- Implement capability-gated rich adapters only where the installed package's
  current public contract is sufficient:
  - Plan Mode: inline plan Markdown and planning/ready/saved/implementing actions
    exposed by versioned completion details, official status/widgets/messages,
    and direct RPC-compatible `/plan` routes;
  - Retry: the official Pi retry activity and settings integration specified
    above, enriched by supported `@narumitw/pi-retry` status values.
- Each adapter has its own exact capability handshake/schema, supported version
  range, generation-safe lifecycle, bounded renderer DTO, empty/loading/error
  states, and generic fallback. Package presence alone never activates rich UI.
- An adapter must consume public structured state or a versioned extension-event
  protocol. PiPilot must not import package-private runtime objects, read private
  artifact paths in the renderer, scrape notification text, or emulate
  `ui.custom()` by parsing terminal output.
- Subagents, Goal, Rewind, Observational Memory, Hermes Memory, BTW, and
  Worktree do not receive rich adapters in this task. Their current releases
  lack a complete externally reachable GUI-facing current-state/action
  contract, depend on private state or notification prose, reject RPC, use
  `ui.custom()`, or replace cwd/session. They remain usable through the generic
  host to the extent official Pi RPC exposes their existing commands, tools,
  statuses, notifications, and dialogs.

### No-session inspector state

- Files, Changes, and Pi Session are session-owned views for presentation
  purposes. Until a session has been selected and its full hydration has
  completed, they must not show content from the previously selected session.
- Entering the no-session or session-loading state must clear/unmount their
  previous projection immediately and prevent new file/change/history fetches
  for the stale session.
- Each affected tab shows a centered empty or loading state inside the complete
  usable inspector region. Loading must not leave stale rows visible behind a
  spinner.
- Terminal remains available when a project workspace is selected because it is
  workspace-scoped, not session-history data. Projectless/no-workspace behavior
  remains the existing unavailable state.
- Late results from a previous workspace, session, runtime generation, or
  refresh epoch must be ignored.

### Generic plugin presentation

- PiPilot must continue to work when no optional extension is installed.
- All extensions first receive generic rendering from official Pi RPC: commands
  and Skills appear directly in the grouped `/` surface, Skills also appear in
  `@`, tool calls/results stay in the transcript, and
  status/widgets/notifications/dialogs use the existing extension UI
  projection.
- Add a generic extension surface host instead of placing plugin output in the
  Pi Session inspector. It owns:
  - ordinary extension notifications and dialogs;
  - a compact, collapsible activity strip above the composer for current
    statuses and string widgets;
  - typed generic tool cards with a neutral tool icon, structured arguments,
    bounded text result, progress, failure, duration, and copy action;
  - extension errors attributed to the owning extension when Pi reports a
    source path.
- Runtime surfaces remain contextual: tool work stays beside the assistant turn
  that launched it; transient status stays near the composer; completed rich
  activity stays in the transcript. Do not add a permanent generic Plugins tab
  to the inspector.
- Do not create package-name-specific settings pages or parse terminal-rendered
  text for every plugin. Rich adapters are reserved for a stable, versioned
  public capability that generic Pi RPC cannot present usefully.
- Structured `subagent` tool calls/results use the same bounded generic tool
  presentation as other extensions. PiPilot does not expose fleet state,
  steering, interruption, stopping, resumption, or spawning controls because
  those actions are not reachable through Pi 0.84.1's public JSONL RPC.
- Plugin-specific paths, run IDs, and raw internal state must not leak through
  renderer contracts. Unknown extensions fall back to the existing generic tool
  presentation.
- `ui.custom()`, component widgets, TUI renderers, footer/header replacements,
  and shortcuts are never guessed from terminal text. A package using them is
  labeled partially supported until a dedicated, versioned adapter exists.

### Structured-clone-safe official Pi RPC

- Every response returned from `pipilot:local-pi:command` must be guaranteed to
  be Electron structured-clone-safe before the IPC handler resolves.
- Preserve Pi's official semantic data, but do not pass an unbounded recursive
  `get_tree` object through Electron. Project it to a bounded, typed, flat
  renderer DTO (or another demonstrably clone-safe representation) in Main.
- Keep strict command/result validation and explicit size/node/depth bounds.
  Do not fix this by returning arbitrary JSON strings or weakening all response
  schemas.
- A deep-tree regression must cross the real Main/preload/renderer IPC boundary
  and must not emit `An object could not be cloned.`
- Clone/projection failures are typed Pi runtime errors with diagnostic context,
  not uncaught Electron handler messages.

### Deterministic first-session activation

- Opening a valid catalog selection remains generation-safe and uses the exact
  Main-owned selection token and official Pi session activation path.
- Catalog invalidations caused by the normal first-activation event burst are
  internal refresh churn. They must converge to the newest catalog snapshot and
  must not open a global error dialog after activation succeeds.
- Replace the fixed two-attempt user-visible failure with a bounded dirty-
  generation/queued-refresh strategy that can absorb a normal lifecycle burst
  without running unbounded work.
- Genuine invalid selection tokens, path/identity changes, deleted sessions,
  and activation failures remain visible typed errors; the implementation must
  not suppress all catalog errors.
- Superseded renderer requests and transient refresh generations never call the
  global operation-failure reporter.

## Acceptance Criteria

- [ ] MCP settings opens on a Codex-like server list and supports add, edit,
      enable/disable, global/project scope, save, and controlled restart using
      the existing Pi JSONC files.
- [ ] Raw JSON remains available, round-trips comments and unknown fields, and
      participates in the same fingerprint conflict handling as the form view.
- [ ] Grouped `/` Commands/Skills and grouped `@` Files/Skills candidates support
      a keyboard-only ArrowUp/ArrowDown/Enter/Escape workflow, including
      wrapping, cross-group movement, disabled/status-row skipping, scroll
      following, valid ARIA active-option linkage, IME protection, and
      deterministic reset after async filtering or scope replacement.
- [ ] `/` and `@` render in the same Codex-style composer-anchored picker shell
      with compact rows, stable sizing, one controlled active state, and
      source-specific partial states. Commands and Skills are immediately
      available in `/`; no `/skills` drill-in, Back step, or separate Skill query
      field remains.
- [ ] The Composer has no `@` toolbar button or hidden toolbar-trigger lifecycle;
      typing `@` is the sole reference-picker entry point, while the existing
      image/file attachment button continues to work independently.
- [ ] Integrations lists global/project Pi packages and resolved Extensions and
      Skills, Prompt Templates, and Themes using the selected local Pi's
      official package model.
- [ ] Installing, updating, or removing a package uses the official matching Pi
      package APIs, reports progress, requires an explicit controlled restart,
      and refreshes the runtime view afterward.
- [ ] Resources show their effective enabled/inherited/disabled state without a
      fake toggle; the UI explains that per-resource filter changes remain in
      Pi's own `pi config` until Pi exposes a public non-interactive mutation
      API.
- [ ] An unknown package with ordinary commands/tools/status UI works without a
      package-specific PiPilot adapter, while TUI-only features are identified
      as unavailable rather than silently claimed as supported.
- [ ] Integrations has responsive list/detail navigation, exact scope and
      restart state, stable row layout, and explicit loading/error/empty states.
- [ ] Generic extension tools use a neutral typed card instead of being
      misrepresented as shell commands; status/widgets use a compact
      collapsible activity strip and remain associated with the current
      hydrated session.
- [ ] Extension notifications appear at the upper-right inside the middle
      conversation column, track sidebar/inspector resizing, remain responsive,
      and never reappear from a previous session or runtime generation.
- [ ] Retry settings show one authoritative persisted Pi value and synchronize
      the active RPC process; the old simultaneous Enable/Disable actions are
      gone and a write/runtime partial failure is visible.
- [ ] Official retry events render attempt count, maximum, countdown, bounded
      reason, Stop, recovery, final failure, and separate summarization labels in
      the composer activity area; session/generation replacement clears them.
- [ ] With `@narumitw/pi-retry@0.31.0` loaded, supported receiving/retrying state
      enriches the official retry block without adding a second retry loop; with
      the extension absent or unsupported, ordinary Pi retry still works.
- [ ] Plan Mode and Retry each have a validated capability/version gate,
      bounded lifecycle-safe renderer projection, useful package-specific GUI,
      and generic fallback.
- [ ] Subagents, Goal, Rewind, Observational Memory, Hermes Memory, BTW, and
      Worktree retain generic official Pi behavior but expose no rich adapter or
      compatibility claim until a future installed release provides a complete
      externally reachable public RPC-safe contract.
- [ ] With no selected session, Files, Changes, and Pi Session show centered
      no-session content and no prior-session data; during selection they show
      centered loading until full hydration settles.
- [ ] Switching sessions rapidly cannot repopulate any affected inspector tab
      with a late response from the previous session.
- [ ] Structured `subagent` tool calls/results remain readable through the
      generic tool renderer without exposing unavailable fleet controls.
- [ ] A 1,762-level or deeper valid Pi history tree can be requested through the
      packaged Electron IPC path without stack overflow or structured-clone
      failure, while bounds and strict validation remain enforced.
- [ ] Repeated first-session activation events converge without the false
      `session catalog changed during refresh` modal.
- [ ] A deliberately stale catalog selection still produces the typed stale
      selection error, proving that real failures were not hidden.
- [ ] Focused unit/contract tests, Electron workflow coverage for both reported
      regressions, typecheck, and production build pass on the completed
      worktree.

## Out of Scope

- Replacing Pi's MCP adapter or inventing MCP support inside Pi core.
- Reimplementing Pi's npm/git installer, package resolver, or package filter
  semantics in PiPilot.
- Single-resource enable/disable controls while Pi 0.84.1 exposes only private
  TUI mutation logic for those filters.
- Replacing Pi's optional subagent runtime with a PiPilot-owned multi-agent
  engine.
- Adding a PiPilot bridge extension to expose another plugin's in-process event
  bus as external RPC.
- Modifying, forking, or publishing external Pi plugins to add missing RPC
  protocols, and rich adapters for packages whose current release lacks one.
- Automatically reproducing arbitrary TUI components, themes, footers,
  shortcuts, or custom terminal renderers inside Electron.
- An online package marketplace or recommendation service; manual official
  package sources are sufficient for the initial manager.
- Reformatting or migrating existing Pi MCP files to Codex TOML.
- Suppressing real catalog token, path, identity, or Pi process failures.
- Treating macOS input-method diagnostic logs as application errors.

## Deferred Integrations

- Subagents, Goal, Rewind, Observational Memory, Hermes Memory, BTW, and
  Worktree may be reconsidered only after an installed release exposes a
  complete, versioned protocol that is reachable from Pi's external RPC mode.
  Generic official Pi rendering remains their supported behavior until then.
