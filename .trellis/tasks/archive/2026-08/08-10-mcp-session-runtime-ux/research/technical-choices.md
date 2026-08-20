# Technical Choices

Date: 2026-08-10

## MCP settings reference

Primary source: [official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

Codex desktop uses a server-list-first flow. Adding a server asks for a name,
then STDIO or Streamable HTTP configuration, and saving requires a restart.
Rows expose enabled/authentication state. Codex's TOML storage is not reusable
for PiPilot: the existing PiPilot service deliberately owns only
`~/.pi/agent/mcp.json` and selected-project `.mcp.json` and preserves JSONC
comments and unknown fields.

Recommended product adaptation:

- reuse the Codex information hierarchy, not its storage format;
- make the structured server list and add/edit form the primary view;
- retain global/project scope and exact path;
- retain Raw JSON as an Advanced tab backed by the same document/fingerprint;
- retain explicit Save and Save + Restart Pi actions;
- show the optional `pi-mcp-adapter` state rather than presenting MCP as Pi core.

Current implementation evidence:

- `src/components/settings/McpSettings.tsx:221`
- `src/main/mcp/mcp-config-service.ts`
- `src/shared/mcp-config-parser.ts`
- `.trellis/tasks/08-08-mcp-config-integration/design.md`

## Official Pi package and resource management

Authoritative local sources for the exact supported Pi 0.84.1 release, resolved
from the configured executable's canonical npm package rather than the separate
Pi-managed extension installation root:

- `<pi-install-root>/docs/packages.md`
- `<pi-install-root>/dist/core/package-manager.d.ts`
- `<pi-install-root>/dist/core/settings-manager.d.ts`
- `<pi-install-root>/dist/index.d.ts`

Pi publicly exports `DefaultPackageManager`, `SettingsManager`, package/resource
types, and progress events. The package manager supports:

- npm, git/URL, and local-path package sources;
- user/global and selected-project scopes;
- install, remove, update, configured-package listing, and update checks;
- resolving enabled Extensions, Skills, Prompt Templates, and Themes;
- official package filter objects and project-over-global deduplication;
- per-operation progress callbacks.

The manager should use this matching local-Pi implementation or invoke the same
local Pi CLI. It should not parse `pi list` text, run a second npm/git installer,
or independently infer Pi's resource filter rules. Because PiPilot deliberately
uses the user's local Pi executable, the design must also prove that the package
manager code comes from the same resolved Pi installation/version rather than a
different bundled SDK.

Recommended Settings information architecture:

1. **Integrations overview**: configured packages, scope, source/version/pin,
   resource counts, restart state, operation progress, and compatibility facts.
2. **Packages**: add official source, update, remove, and inspect contained
   resources.
3. **MCP**: Codex-style server list/form plus existing Raw JSON mode.
4. **Extensions**: resolved paths/resources and effective filter state.
5. **Skills**: resolved Skills, scope/source, enabled state, description, and
   invocation name.
6. **Prompt Templates / Themes**: include both because PiPilot will manage the
   complete local Pi installation. Themes remain explicitly TUI-only and never
   alter PiPilot's Electron appearance.

Online package discovery/gallery is separable. Manual official sources solve
the local management problem without adding registry search, recommendations,
preview media, or marketplace trust policy to this task.

The public 0.84.1 manager resolves effective filters but does not expose the
TUI config selector's single-resource mutation operation. `SettingsManager`
can replace raw `PackageSource[]`, but reproducing the selector's pattern,
autoload, manifest, inheritance, and delta rules would be a second filter
implementation. Resource rows are therefore read-only in this task; per-resource
changes remain in official `pi config` until Pi publishes a non-interactive API.

## Plugin compatibility layers

Official Pi RPC 0.84.1 provides a strong generic baseline:

- `get_commands` includes extension commands, prompt templates, and Skills;
- all LLM tool calls, progress updates, and tool results are streamed;
- `select`, `confirm`, `input`, `editor`, `notify`, `setStatus`, `setWidget`,
  `setTitle`, and `set_editor_text` have an RPC sub-protocol;
- `ui.custom()`, component-factory widgets, custom footer/header/editor/working
  indicator, TUI shortcuts, themes, and custom TUI message/tool renderers are
  unavailable or no-op.

This yields four product layers:

| Layer | Behavior | PiPilot handling |
| --- | --- | --- |
| Generic runtime | Hooks, commands, Skills, tools, tool results | Automatic through official RPC |
| Generic UI | Dialogs, notifications, string status/widgets, editor text | Existing typed extension UI projection |
| Rich semantic capability | Fleet state, goal state, custom workflow control | Optional versioned adapter, generic fallback |
| TUI presentation | Footer, themes, shortcuts, `ui.custom()`, custom terminal renderers | Mark unavailable; do not emulate automatically |

Observed installed-package classification (based on package manifests and local
source, not package-name assumptions in product code):

| Package group | Generic RPC status |
| --- | --- |
| `pi-mcp-adapter`, `pi-hermes-memory`, `pi-simplify`, `pi-codex-goal`, `pi-observational-memory`, `pi-lsp`, `pi-hashline-edit-pro`, `pi-retry` | Mostly automatic: hooks/tools/commands/status |
| `pi-plan-mode`, `pi-rewind` | Mostly automatic; string widgets/dialogs work, TUI shortcuts do not |
| `pi-subagents` | Core tool/results work; component FleetView and in-process control RPC are not externally reachable, so use generic rendering |
| `pi-btw` | Depends heavily on `ui.custom()`; requires a dedicated capability/UI adaptation for its primary flow |
| `pi-worktree` | Custom menu plus plugin-driven cwd/session replacement; conflicts with PiPilot's user-selected project scope without explicit integration |
| `pi-starship`, `pi-pretty`, `pi-diff`, `pi-themes-bundle` | TUI presentation only or primarily TUI; install/manage but no Electron visual effect |

Compatibility cannot be inferred perfectly from a package manifest because Pi
has no RPC-compatibility declaration. The manager should distinguish:

- **configured/installed/resolved** facts from the official package manager;
- **observed runtime surfaces** from commands, tool events, extension UI, and
  extension errors;
- **curated rich compatibility** only when PiPilot implements and validates a
  public versioned capability.

Do not present an unobserved package as fully compatible. Unknown packages are
still useful through the generic layers without a package-specific settings
page.

## GUI adaptation

Current renderer evidence:

- `src/components/settings/SettingsLayout.tsx:18-35` has a flat Settings nav and
  a standalone MCP section.
- `src/components/settings/SettingsLayout.tsx:139-192` constrains all sections
  to `max-w-2xl`; a package list/detail manager needs a wider section-specific
  content width without changing simple settings pages.
- `src/components/chat/ExtensionUiDialog.tsx:30-171` already implements official
  RPC select/confirm/input/editor dialogs.
- `src/components/chat/ExtensionSurfaces.tsx:6-81` already implements
  notifications, raw string widgets, and status text.
- `src/App.tsx:537-569` mounts widgets around the composer and statuses below it,
  gated on fully hydrated conversation state.
- `src/renderer/pi-rpc/presentation.ts:26-64` classifies unknown plugin tools as
  shell commands; `src/components/chat/ToolCallCard.tsx:28-98` only has
  read/shell/edit visual variants.

Recommended management GUI:

```text
Settings
  Integrations
    [Global | Project]   Search...                 [+ Add]
    Overview | Packages | MCP | Resources          Restart required

    package/resource list        selected detail
    ----------------------        ------------------------------
    pi-subagents  0.44.0          source / scope / version
    MCP adapter   2.21.1          resources and effective state
    ...                             runtime surfaces / diagnostics
                                      Update  More
```

- Wide windows use one unframed list/detail surface; narrow windows show the
  list first and drill into a full detail screen with Back.
- The package list is dense and work-focused, not a grid of marketing cards.
- Package operations stay on their row/detail view. Restart is one shared,
  persistent pending state, not repeated per package.
- MCP keeps its own structured list/editor because MCP server configuration is
  not equivalent to Pi package resource filtering; Raw JSON remains Advanced.
- Resources use one view with Extension/Skill/Prompt/Theme filters. The same
  row treatment avoids four separate navigation trees.
- Compatibility labels are precise facts: `Generic RPC`, `Rich adapter`,
  `Partial`, `Pi TUI only`, or `Not observed`. They are not ratings.

Recommended runtime GUI:

```text
assistant response
  generic tool card / rich activity block

  [compact extension activity strip: plan · goal · subagents]
  composer
```

- Tools and completed rich activity remain inline with the turn that produced
  them.
- `setStatus` and string `setWidget` share a compact collapsible activity strip
  immediately above the composer. It replaces raw always-expanded `<pre>`
  blocks while preserving the exact extension-provided text in expanded mode.
- Notifications remain toast-like and dialogs remain modal because these map
  directly to official RPC intent.
- Unknown tools receive a neutral tool icon and typed generic card rather than
  a terminal icon. Arguments and results are bounded and copyable.
- No generic plugin content is put into the Pi Session inspector. That tab owns
  official history/tree/entries/shell context, not extension activity.
- A rich adapter may replace only the generic presentation for a stable
  capability. It must retain generic fallback on missing/unsupported versions.

Do not treat `pi-subagents`' in-process extension-event protocol as an external
Pi RPC. Pi 0.84.1 exposes no JSONL command for emitting arbitrary `pi.events`,
so PiPilot can render the structured `subagent` tool generically but cannot
reach `ping`, fleet status, or control methods without adding a non-official
bridge extension. `pi-btw` and `pi-worktree` remain generic/degraded for the
separate TUI and cwd/session reasons described below.

## Composer keyboard candidate control

Current renderer evidence:

- `src/components/chat/Composer.tsx:619-642` explicitly intercepts ArrowUp,
  ArrowDown, Enter, and Escape for the `@` picker. It flattens Files then Skills
  into one selectable sequence and wraps at the ends.
- `src/components/chat/Composer.tsx:748-778` implements the same pattern for the
  top-level `/` candidates.
- `src/components/chat/SkillPicker.tsx:207-248` leaves the nested `/skills`
  search uncontrolled and relies on `cmdk`'s internal selection and scrolling;
  the confirmed product direction removes this nested level entirely.
- Existing Electron coverage verifies pointer selection and the `@` listbox's
  active-descendant linkage, but it does not exercise Arrow navigation or a
  keyboard-only direct Skill selection from `/`.

Recommended implementation contract:

- use one small pure active-candidate transition helper for both picker views;
- keep a controlled active ID for grouped `/` and grouped `@`, and derive each
  list from enabled rows in rendered order;
- reconcile the ID whenever query results or asynchronous file/command catalogs
  change, selecting the first enabled candidate or clearing it when empty;
- connect pointer hover and keyboard movement to the same controlled ID;
- scroll the active option into view after movement without moving editor/search
  focus;
- let the editor own `/` and `@` keystrokes and route both through the same
  transition rules; there is no nested Skill input or focus transfer;
- keep the existing composition/keyCode-229 guards and exact suggestion/session
  identity checks before insertion;
- add one keyboard-only Electron path that moves from Commands into Skills in
  `/` and selects a filtered Skill directly, plus one for `@` that crosses Files
  into Skills and focused pure transition tests.

This is intentionally not a second command palette abstraction. `cmdk` remains
the visual/list primitive, while PiPilot owns deterministic selection because
the candidates arrive from multiple asynchronous official Pi sources and must
remain generation-safe.

## Codex-style candidate surface

Direct automated inspection of the locally running Codex app was unavailable:
the desktop automation provider explicitly blocks `com.openai.codex`. Official
web lookup was also unavailable in this session because the configured search
service returned `auth_not_found`. The recommendation therefore relies on the
user's stated Codex interaction target, the supplied Codex screenshots, and the
current PiPilot implementation evidence; implementation visual review should
compare against a user-provided picker screenshot if exact pixel matching is
required.

Current PiPilot divergence:

- top-level `/` and nested `/skills` share one Popover component, but the nested
  view replaces editor focus with a separate search field and leaves active
  selection implicit;
- `@` is a separately styled portal with a repeated `@query` header, controlled
  active ID, two source groups, and different maximum height;
- both use `cmdk`, so the divergence is product state/composition rather than a
  need for another UI dependency.

Recommended shell:

```text
composer-anchored picker
  section label
  icon  primary label                    scope/source
        optional description or path
  section label
  ...
```

Use the same Popover positioning and row primitives for both triggers. Keep the
Tiptap Suggestion identity/range logic for `@`, but render it through the shared
shell. Remove the locally projected `skills-navigation` row and merge resolved
Skills into the slash candidate projection after official Commands, with light
group labels and one shared editor query. A bounded scrolling surface handles a
large Skill set without adding an extra interaction step.

The `@` toolbar button is not part of the target interaction. Remove the
`TbAt` button in `Composer`, the public `insertTrigger()` editor handle, and the
toolbar-origin suggestion/selection-restoration branches that become
unreachable. Preserve typed-trigger Suggestion identity, IME protection,
clipboard semantics, scope/history reset, and the independent attachment
button. This reduces rather than hides the parallel trigger state machine.

## Conversation-column notification placement

`ExtensionNotifications` currently owns a viewport-fixed host and `App` mounts
it after the complete three-column layout. The intended middle-column anchor is
therefore a structural change, not a numeric `right` offset:

- make the conversation `<main>` the positioning boundary;
- mount the notification host inside it after the chat header;
- use an absolute upper-right stack constrained by the main column;
- keep transcript and composer flow unchanged;
- keep notification surfaces interactive while the host remains pointer-event
  transparent;
- place the host below modal/popover layers and above transcript content.

This avoids calculating sidebar/inspector widths in JavaScript and makes panel
resize behavior follow CSS layout automatically.

## Session-owned inspector projection

`ElectronInspector` starts Files and Changes requests on mount whenever a
workspace exists (`src/components/inspector/InspectorPanel.tsx:74-149`). The Pi
Session tab alone receives the conversation readiness projection. Therefore a
no-session transition can visually retain or refetch workspace data while the
main conversation correctly clears.

The minimal consistent rule is presentation ownership, not filesystem
ownership: Files, Changes, and Pi Session are hidden and do not fetch until the
selected Pi session is hydrated. Terminal remains usable for a selected project
because it is a workspace tool and has no transcript projection. Each async
controller needs a session/generation epoch so late results cannot restore old
data.

## Structured clone failure

The command handler returns the parsed official response directly to Electron
(`src/main/ipc/register-local-pi-ipc.ts:237-245`). `get_tree` retains a recursive
object graph even though its validation is iterative
(`src/shared/local-pi.ts:533-638`, `src/shared/local-pi.ts:703`). A real session
already demonstrated 1,762 levels, so passing the nested result across Electron
IPC is a high-confidence structured-clone failure candidate. The repeated
handler error should still be reproduced with command tracing before declaring
it the only source, because official entries also contain extension-defined
`unknown` details.

Recommended boundary:

- preserve the official nested object inside Main only;
- validate with existing node/depth bounds;
- project `get_tree` to a typed flat array containing stable entry identity,
  parent identity/depth, label metadata, and leaf identity;
- validate the flat renderer result and explicitly probe cloneability before
  returning it;
- add an actual Electron IPC regression using a deep tree and a separate case
  for unsupported extension-defined values.

## First-activation catalog churn

Explicit refresh calls now coalesce, but lifecycle events legitimately call
`invalidate()` while the scan is running. `refreshFirstPage()` retries only two
times and then converts version churn into a user-visible
`SESSION_CATALOG_REFRESH_STALE`
(`src/main/conversations/official-pi-session-catalog.ts:837-860`). Renderer
subscriptions can initiate several refreshes during one activation
(`src/store/workspace.tsx:570-615`).

Recommended state machine:

- one scan promise per scope;
- invalidation marks the running scan dirty and records the latest generation;
- after a scan, rescan while dirty within an explicit time/iteration budget;
- if the burst outlives the foreground budget, publish no stale snapshot and
  schedule one queued refresh instead of opening a global modal;
- preserve stale cursor/token/path errors for user actions;
- test a realistic first-activation burst and an intentionally stale selection.

## Subagent integration boundary

Primary Pi source: [official Pi coding-agent README](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md)

Pi core intentionally does not define a subagent runtime. The locally installed
optional `pi-subagents@0.44.0` extension provides:

- a `subagent` tool with structured `Details` and progress/result data;
- foreground transcript rendering and background FleetView behavior;
- an internal versioned extension-event RPC with `ping`, `status`, `spawn`,
  `steer`, `interrupt`, `stop`, and `resume`;
- bounded public fleet status entries with agent, role, model, effort, start
  time, token counts, and goal.

Evidence:

- `<pi-agent-dir>/npm/node_modules/pi-subagents/README.md:88`
- `<pi-agent-dir>/npm/node_modules/pi-subagents/src/extension/index.ts:531`
- `<pi-agent-dir>/npm/node_modules/pi-subagents/src/extension/rpc.ts:17`
- `<pi-agent-dir>/npm/node_modules/pi-subagents/src/shared/types.ts:950`

The protocol is complete inside Pi's extension process, but it is not reachable
from the official external JSONL RPC. `SUBAGENT_RPC_REQUEST_EVENT` and its reply
events are registered on `pi.events`; the official 0.84.1 `RpcCommand` union has
no arbitrary extension-event command. The supported PiPilot contract is
therefore extension-agnostic generic rendering of the structured `subagent`
tool call/result. Fleet status and controls are deferred until Pi or the owning
extension publishes an externally reachable official protocol.

## Evaluated rich adapter candidates

The following assessment uses the exact packages currently installed in the
user's selected local Pi installation on 2026-08-10, not registry-name guesses.

| Package | Current structured surface | Useful PiPilot adaptation | Recommendation |
| --- | --- | --- | --- |
| `pi-subagents@0.44.0` | Versioned `ping`/fleet/control events exist only on Pi's in-process extension event bus; structured tool results cross ordinary RPC | Generic structured tool rendering | No rich adapter until the protocol is externally reachable |
| `@narumitw/pi-plan-mode@0.49.3` | `plan_mode_complete` details `{version:1, source, plan}`, status/widget state, `proposed-plan` message, and direct RPC-compatible `/plan` routes | Inline Markdown Plan block with planning/ready/saved/implementing state and only validated Show, Implement, Save, Revise, Export, or Exit actions | Confirmed; current contract is sufficient |
| `pi-codex-goal@0.2.0` | Structured tool details exist, but there is no versioned direct current-state/action RPC; persistent state uses package-private session entries | Generic goal command/tool/status rendering | No rich adapter in current task |
| `@narumitw/pi-retry@0.31.0` | Pi official retry events/commands plus extension status key `retry`; extension adds provider classification and stall recovery but no retry loop | Authoritative persisted toggle, attempt/countdown/reason/Stop/recovered/final-failure activity block | Confirmed; combine official Pi state with exact extension capability |
| `pi-rewind@0.5.0` | Private in-process checkpoint map; user flow is `ui.select`/`confirm` plus notification text | Generic command/dialog/notification rendering | No rich adapter in current task |
| `pi-observational-memory@3.0.3` | Session-ledger data is internal; `/om:status` and `/om:view` emit formatted notification strings; `recall` has structured tool results | Generic command/tool/notification rendering | No rich adapter in current task |
| `pi-hermes-memory@0.9.4` | Many structured tools and commands backed by a private SQLite/store model; `memory-skills` also uses `ui.custom()` | Generic command/tool/dialog rendering where official RPC supports it | No rich adapter in current task |
| `@narumitw/pi-btw@0.49.6` | `/btw` explicitly rejects non-TUI mode and its model resolution, composer, transcript pager, and follow-up flow use `ui.custom()` | Compatibility label explaining TUI-only primary flow | No rich adapter in current task |
| `@narumitw/pi-worktree@0.49.3` | Private TUI-kit menu with add/switch/remove/prune/configure flows and session/cwd replacement | Generic command surface where available; no project/session integration | No rich adapter in current task |

The remaining installed packages do not justify dedicated rich surfaces in the
first release:

- `pi-mcp-adapter` belongs in the Integrations/MCP settings experience already
  specified by this task;
- `pi-simplify`, `@narumitw/pi-lsp`, `pi-hashline-edit-pro`, and ordinary
  memory utility tools should use the improved generic typed tool cards;
- `@narumitw/pi-starship`, `@heyhuynhgiabuu/pi-pretty`,
  `@heyhuynhgiabuu/pi-diff`, and `@firstpick/pi-themes-bundle` are TUI
  presentation packages and should be manageable/labeled, not reproduced in
  Electron.

The user subsequently narrowed rich adaptation to packages whose current
installed release already provides a complete, externally reachable RPC-safe
public contract. After checking the transport boundary, the in-scope adapters
are Plan Mode and Retry. Every adapter must:

- activate only after exact package/version and capability/schema validation;
- consume bounded public data, never private paths or terminal-rendered text;
- retain generic commands, tools, status, widget, and notification fallback;
- clear on session/generation replacement and ignore late extension events;
- expose only controls the capability explicitly advertises;
- degrade to a neutral generic tool/activity card on unsupported versions.

Subagents, Goal, Rewind, Memory, BTW, and Worktree remain on generic official Pi
rendering. They can be reconsidered in a future task after their owning
extensions publish a complete versioned GUI-facing protocol reachable from
external Pi RPC; PiPilot will not implement bridge extensions, parallel private
parsers, or changes to those external repositories in this task.

## Retry integration

Exact installed sources:

- `@narumitw/pi-retry@0.31.0` README and `src/retry.ts`;
- Pi 0.84.1 `docs/rpc.md` and `dist/modes/rpc/rpc-types.d.ts`;
- Pi 0.84.1 public `SettingsManager` declarations;
- PiPilot `src/renderer/pi-rpc/projector.ts`, `src/store/pi-rpc.tsx`, and
  `src/components/chat/ChatHeader.tsx`.

The extension is deliberately not a retry engine. It recognizes a bounded set
of provider failures, adds Pi's retryable-provider hint, detects a stalled
stream, and calls `ctx.abort()` after its watchdog fires. Pi core still owns
attempts, maximum attempts, exponential delay, continuation, and `abort_retry`.

Pi's official RPC already provides the structured GUI data PiPilot needs:

- `auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }`;
- `auto_retry_end { success, attempt, finalError? }`;
- `set_auto_retry { enabled }` and `abort_retry` commands;
- separate summarization retry events.

PiPilot currently retains these values in `LocalPiProjectedRetry`, but exposes
only `retryActive` and an unused `retryMessage`. ChatHeader always displays both
Enable and Disable actions because official `get_state` does not return the
current in-memory retry override. This is the concrete usability defect.

There is also a state-consistency defect: `set_auto_retry` changes only the
current Pi process, while `pi-retry` re-reads persisted `retry.enabled` through
`SettingsManager` at session start and before every provider request. The public
Pi SettingsManager exposes `getRetryEnabled()`, `setRetryEnabled()`, `flush()`,
and `getRetrySettings()` with effective `maxRetries` and `baseDelayMs`.

Recommended adapter:

1. Integrations owns one persisted retry toggle through the matching local Pi
   `SettingsManager`; successful persistence is followed by `set_auto_retry` for
   the active process.
2. The composer activity strip renders official retry state with attempt/max,
   deadline-based countdown, bounded reason, and Stop. It transitions to
   Retrying after the deadline and to recovered/final-failure on the official
   end event.
3. A supported exact `pi-retry` version may map status key `retry` values
   `receiving` and `retrying` into that same block. All other values retain the
   generic status rendering.
4. Do not parse warning notifications, injected error prose, or private timers.
   If richer classifications or watchdog deadlines are later required, the
   extension must publish a versioned capability/event protocol.
5. Reset timers and projection on session/generation changes; do not let a late
   event revive a prior retry.

This adapts `pi-retry` without duplicating it and makes the existing official Pi
retry path understandable and controllable even when the optional extension is
not installed.
