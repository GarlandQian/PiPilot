# Technical Design

## Architecture

```text
React PiRpcProvider / presentation selectors
  -> typed preload LocalPi API
  -> Main LocalPiRuntimeHost
  -> local pi --mode rpc --approve

OfficialSessionCatalog -> session sidebar -> Main process replacement with --session -> snapshot replace
Extension UI request -> PiPilot dialog/status/widget -> official response
```

The renderer sees documented plain RPC DTOs and host generation/status metadata.
It never imports Pi runtime code. Main owns process and request correlation;
renderer owns transient view projection and user interaction.

## Renderer State Ownership

One provider is keyed by `{scopeId, processGeneration, sessionId}` and owns:

- connection/readiness and current official `get_state` result;
- current official message snapshot plus one in-progress delta assembler;
- available models/thinking levels and steering/follow-up modes;
- command catalog, queue, retry/compaction/tool progress, and extension errors;
- keyed extension status/widgets/title and the single dialog queue;
- session stats consumed by the cost sibling.

The provider subscribes once to host events for its generation. React consumers
use narrow contexts/selectors so high-frequency transcript updates do not
rerender settings, sidebar, or inspector trees. Derived title, busy state,
button availability, and groups are computed from current state rather than
synchronized by effects.

## Snapshot And Event Rules

On ready/reconnect/session replacement, request a snapshot batch:

1. `get_state`;
2. `get_messages`;
3. `get_available_models` and `get_available_thinking_levels`;
4. `get_commands`;
5. `get_session_stats`.

Commit the batch only if its process generation and expected session still
match. It replaces transcript, modes, command catalog, pending queue count,
progress, and derived metadata atomically from the renderer's perspective.
`get_state` does not contain pending message bodies, so a reconnect never claims
detailed queue contents until a current-generation `queue_update` arrives.

## Real Model Source And Picker

The renderer model slice stores only full official `Model` objects returned by
`get_available_models`. The selected identity is the `{provider, id}` pair from
the same generation/session snapshot's `get_state.model`; no PiPilot
`configured` flag, credential record, allow-list, or mock fallback participates.
Unavailable local-Pi state has `models: []` plus explicit connection/setup
status. The root desktop bootstrap verifies the preload bridge before mounting
providers; there is no browser-preview provider or demo model environment.

Selecting a row disables repeated selection, sends exactly one
`set_model(provider, modelId)`, and commits only a response from the current
generation. On success, use the returned full `Model`, then refresh `get_state`
and `get_available_thinking_levels`. On failure, retain the prior selected model
and present the official error. Request generation/sequence guards prevent a
late list, selection, or levels response from overwriting a newer scope/session.

Composer replaces the current unbounded `DropdownMenu` with the existing
Popover and Command primitives; no new dependency is needed. The content width
is `min(360px, calc(100vw - 24px))` and its total maximum height is
`min(440px, calc(100vh - 96px))`, with collision padding around the viewport.
Search/header and optional footer remain fixed; only the results area scrolls,
bounded by `min(352px, calc(100vh - 184px))`.

Results are one column and grouped by official provider. Each row shows official
`name` (falling back to `id`) as the primary label, provider and exact ID as
secondary metadata, and a check icon for the selected identity. Long values use
ellipsis plus a tooltip and never create a second horizontal column. Search
matches name, ID, and provider; keyboard navigation, Escape, focus return, and
scrolling the selected row into view follow the existing Command/Popover
accessibility behavior. Loading, no-configured-model, disconnected, and error
states preserve the same bounded surface. Model Settings may expose real status,
refresh, and official Pi setup guidance, but no credential editor. It consumes
the exact same selectors/actions as Composer. Thinking controls enumerate only
the current response from `get_available_thinking_levels`; an unsupported level
cannot be rendered or submitted. Every Model returned by the validated official
response remains visible, rather than being hidden by PiPilot token metadata or
`configured` heuristics.

`message_start` seeds the transient assistant message. `message_update` applies
only documented content-index delta variants. `message_end.message` replaces
the assembled message. Turn/tool/queue/compaction/retry events update their
specific presentation slice. `session_info_changed` and
`thinking_level_changed` update the current official session view;
extension-only `entry_appended` is accepted without fabricating a transcript
message. `agent_settled`, session-changing command success, unknown sequence, or
reconnect may trigger a bounded snapshot refresh.

No official event is translated into the old `AgentEvent`/`ChatMessage`
protocol or persisted separately. Presentation adapters format official content
for existing components but retain official discriminators and IDs.

## Running Input And Official Queues

Composer submission takes one immutable snapshot of text, images, and formatted
context. At dispatch time the provider checks current official `isStreaming`:

| State/action | Official command |
| --- | --- |
| idle primary | `prompt` |
| streaming primary | `follow_up` |
| streaming split-menu Steer | `steer` |
| streaming Stop | `abort` |

There is no sticky send-mode state. The primary action is Queue on every running
submission and after every session/process replacement. The Steer menu item
submits that captured draft once and closes. A pending command disables another
submission of the same draft while leaving Stop available. Success clears only
the captured text/images/context that still match; rejection, timeout,
disconnect, or a race in which streaming has settled retains them and displays
the official error. PiPilot does not retry as `prompt` or another queue type.

Composer keeps the Stop icon in a stable independent slot and uses a compact
split submit control while streaming: the primary icon+`Queue` command and a
chevron menu containing icon+`Steer current task`. Idle restores the normal send
icon. Existing keyboard submission follows the primary action, therefore queues
while running. All controls retain fixed height/width constraints so labels,
busy state, queue count, and Stop do not shift the footer. Tabler supplies the
queue/route/stop icons and tooltips name unfamiliar actions.

The provider owns transient queue presentation for its generation/session:

- `get_state.pendingMessageCount` seeds an aggregate count with
  `detailsKnown: false` after snapshot/reconnect;
- each `queue_update` atomically replaces the official `steering[]` and
  `followUp[]` strings and sets `detailsKnown: true`;
- session/process replacement clears arrays and count before hydration;
- delivered messages disappear through `queue_update` and later appear only via
  official message events/snapshots.

A compact queue indicator opens a collision-aware popover. It groups Steer and
Queue lists, truncates long text with tooltips, caps the results region at 192px,
and shows an aggregate count when details are unavailable. A footer uses two
segmented controls for the official steering and follow-up delivery modes,
calling `set_steering_mode`/`set_follow_up_mode` and refreshing `get_state` after
success rather than treating a local choice as authoritative. Because entries
have no official IDs and RPC has no dequeue command, rows are read-only with no
cancel, edit, reorder, or optimistic removal.

Before dispatch, match the first slash token against the current
`get_commands` snapshot. `source: "extension"` commands use an explicit
`Run now` action backed by `prompt`, because Pi forbids them in `steer` and
`follow_up` and handles them immediately during streaming. `source: "prompt"`
and `source: "skill"` retain Queue/Steer behavior. Unknown slash text remains an
ordinary message and any official rejection is shown without local inference.

## Action Mapping

| User action | RPC command/flow |
| --- | --- |
| Send while idle | `prompt` with text/images |
| Running primary (default every time) | `follow_up` |
| Explicit guide during active turn | `steer` |
| Stop | `abort` |
| New/open | `new_session` / Main-owned process replacement with official `--session` |
| Rename | `set_session_name` |
| Fork/duplicate/history inspection | `get_fork_messages`, `fork`, `clone`, `get_entries`, `get_tree` |
| Model list/current | `get_available_models` + `get_state.model` |
| Select model | `set_model(provider, modelId)`, then state/thinking refresh |
| Thinking | `get_available_thinking_levels` + set/cycle commands |
| Steering/follow-up policy | `set_steering_mode`, `set_follow_up_mode` |
| Compact | `compact`, `set_auto_compaction` |
| Retry | `set_auto_retry`, `abort_retry` |
| Cost/context | `get_session_stats` |
| Extension/prompt/skill command | `get_commands`, then `prompt` with slash text |
| Export | `export_html` when surfaced |
| Reload local Pi resources | controlled process restart + snapshot/catalog refresh |

Command errors remain official errors. A successful new/switch/fork/clone/
rename refreshes `get_state`, messages as appropriate, stats, and the read-only
catalog before controls return to ready.

## Extension UI Bridge

Dialog requests are FIFO and retain `{generation, id, method}`. PiPilot renders:

- `select` as a keyboard-accessible option dialog;
- `confirm` as confirm/cancel;
- `input` as single-line text;
- `editor` as multiline text.

Submission sends exactly one documented `extension_ui_response` with the same
ID. Dismissal sends `cancelled: true`. Process/session replacement dismisses the
local surface and lets Main cancel obsolete pending interaction.

Fire-and-forget requests map as follows:

- `notify` -> toast/notice using the official severity;
- `setStatus` -> keyed compact status collection;
- `setWidget` -> keyed text widget near the composer, honoring clear;
- `setTitle` -> session/window presentation title without PiPilot persistence;
- `set_editor_text` -> current composer draft update.

Unsupported TUI APIs produce no RPC request upstream. The UI documents that
official RPC boundary where an extension error/status makes it relevant; it does
not synthesize unavailable controls.

## Session Navigation

The sidebar reads the catalog child and keys rows by opaque selection plus
session ID. Selection invokes the official switch flow. Titles prefer the
current official `sessionName`, then catalog first prompt, then localized
untitled copy. PiPilot does not pin, rename files, or delete files directly.

## Plugin And MCP Boundary

All normal Pi features work with no extension installed. Commands and supported
extension UI appear only when the selected local Pi reports them. Restart is the
generic refresh mechanism after external `pi install/remove/update` operations.

The MCP sibling may detect the adapter's `mcp` command, route its TUI-only
entrypoints to Settings, and edit standard MCP config. It cannot change this
provider into an MCP client or make core Pi usage depend on the adapter.

## Removed Renderer Surface

Remove custom message reducer/store semantics, approval cards/state, credential
and resource stores/settings, model-safety explanations, model mock/fallback
constants and credential gating, MCP risk review, session delete/pin, and private
Agent preload calls. Retain desktop workspace, files,
terminal, read-only Diff, appearance, localization, and supported official
session actions.

## Test Design

- Snapshot generation/session guards and atomic replacement after reconnect.
- Delta assembly for text/thinking/tool calls and authoritative message end.
- Queue/tool/compaction/retry/extension-error event presentation.
- Running Composer idle/queue/steer/stop routing, duplicate prevention, captured
  draft clearing, rejection retention, and streaming-settled race.
- Queue update replacement, reconnect count-only state, generation/session reset,
  one-at-a-time/all mode changes, bounded keyboard UI, and structural absence of
  unsupported item mutation/persistence.
- Extension versus prompt/skill command routing during streaming.
- Every action mapping, cancellation/error, and post-session refresh.
- Real model hydration/selection and generation guards; no-model, disconnected,
  and official-error states; no mock fallback.
- Composer/Settings parity and structural absence of hard-coded thinking levels,
  configured/invalid-model policy, credential operations, and duplicate state.
- Model picker keyboard/search behavior and visual bounds with long provider/model
  values at normal and narrow Electron viewports; visual tests launch Electron,
  not a standalone Vite page.
- Extension dialog correlation, FIFO/cancel, keyed status/widget/title/editor
  updates, and process-generation cleanup.
- StrictMode/remount listener ownership and scope/process replacement.
- Generic extension fixture before/after controlled restart; TUI-only degraded
  fixture behavior.
- Structural absence of legacy renderer Agent schemas and private Pi imports.

## Rollback

The production provider cutover is one boundary. Rollback is a commit revert;
there is no runtime toggle or embedded-Worker fallback after the child lands.
