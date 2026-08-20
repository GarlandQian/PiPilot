# Technical Design

## System Boundary

```text
PiPilot React desktop presentation
  -> typed preload IPC
  -> Main services
       - LocalPiRuntimeHost (process + documented JSONL)
       - ConversationContextService / OfficialSessionCatalog
       - WorkspaceContentService (files/search/read-only Diff/terminal owner)
       - Settings + optional standard MCP config services
  -> selected local pi --mode rpc --approve
       - official Agent/models/tools/sessions/auth/packages/plugins
       - optional pi-mcp-adapter -> MCP servers
```

PiPilot owns desktop interaction, process connection, filesystem presentation,
and explicitly saved standard config. Local Pi owns all Agent semantics and
optional plugin execution. No fallback runtime or private client sits beside it.
The root renderer requires the typed preload bridge before providers mount;
there is no supported standalone browser runtime or mock application branch.

## Runtime And Renderer

Resolve explicit executable, process PATH, login-shell/Windows discovery;
canonicalize/probe version and complete a no-model state/command handshake.
Spawn with normal environment and the active conversation scope cwd. Strict LF JSONL handles
partial UTF-8, request IDs, backpressure, official events/UI, stderr, unknown
records, crash/restart/replacement, and clean shutdown.

A renderer provider keyed by scope/process generation/session hydrates
official state, messages, models/levels, commands, and stats. It applies only
documented deltas/events to transient view state and replaces from snapshots
after reconnect/session mutations. Late generation responses are ignored. The
old durable transcript/policy stores are removed.

Supported extension dialogs return exact IDs. Notify/status/widget/title/editor
requests update keyed presentation surfaces. TUI-only APIs are not emulated.

## Conversation Scopes And Sessions

`ConversationScope` is either an explicitly selected project or projectless.
Main resolves the former to its canonical selected cwd and the latter to
`userData/general-chat/workspace`. Home-directory fallback and project discovery
do not exist.

PiPilot passes only cwd plus an optional selected session file and never passes
`--session-dir`. Derive each observed catalog directory from
`get_state.sessionFile`; the catalog extracts bounded current-format display
metadata only. It does not infer Pi's storage layout, copy sessions, or maintain
a transcript database.

Credential, permission, and resource-preference repositories and path contracts
are removed from source with no old-data cleanup path. Remove embedded
Worker/protocol/reducer/policies, environment/
sensitive-path filters, Diff mutation/fingerprints, build input, and direct Pi
dependencies after all production callers cut over. Keep canonical workspace
containment, read bounds, atomic surviving app/config writes, and RPC guards.

## Settings Coordination

The surviving atomic app settings contain the explicit Pi executable and the
single current terminal typography schema
`{ terminal: { fontFamily, fontSize } }`. No prior schema is parsed or upgraded.
Runtime, Terminal, and MCP Settings changes land sequentially or rebase against
the latest shared schema/layout to avoid parallel edits.

The final Settings source matrix is:

| Section | Authoritative source |
| --- | --- |
| General | Main LocalPi executable configuration/probe snapshot |
| Appearance / Language | current Main-owned AppSettings snapshot |
| Models | official `get_available_models`, `get_state.model`, and thinking commands |
| Terminal | current Main-owned terminal typography settings plus live xterm state |
| MCP | standard project/global JSONC files and official `get_commands` detection |
| About | Electron Main `app.getVersion()`, platform, architecture, and Electron version |

Permissions, Agent Resources, Updates, PiPilot credential forms, and disabled
notification/sound/usage rows are removed. The renderer may use a cached copy of
the last Main Settings snapshot only as a desktop pre-paint hint; it is never a
web-mode authority and cannot invent values. Loading/error/absent sources render
explicit states.

MCP files are deliberately outside AppSettings. Main resolves only project
`.mcp.json` and global `~/.pi/agent/mcp.json`, parses/edits with `jsonc-parser`,
checks expected byte fingerprint, and publishes by sibling temporary file plus
atomic rename. The renderer never supplies an arbitrary target path.

## UI Workflows

### Models

The provider takes full configured models from `get_available_models`, selected
identity from `get_state.model`, and switches through `set_model`. Composer uses
the existing Popover/Command primitives with fixed search controls, one-column
provider-grouped rows, viewport-bounded width/height, and an independently
scrolling results region. Missing Pi/bridge states are explicitly empty; no
browser model fixture or PiPilot credential gate exists.

### Header

The left sidebar toggle becomes ChatHeader's fixed leading icon slot; the right
inspector toggle stays trailing. The secondary metadata group receives a
stable-width official cost plus context indicator. Both preserve layout while
state loads or panels animate.

### Icons And Brand

One resolver maps Material Icon Theme filename/extension/folder/open-folder
definitions to a bounded Vite/Electron asset manifest with generic fallbacks.
Only file-tree/context decorations use it. Tabler remains the command icon set.
Renderer/package brand assets derive from one canonical PiPilot mark and are
regular files/build output, not symlinks.

### Terminal

Terminal Settings and xterm use one `resolveTerminalFontStack`. Selected/custom
mono family precedes Latin developer fonts, CJK fallbacks, and `monospace`.
Changing family/size updates the existing xterm instance and schedules one fit;
PTY identity/output remain unchanged.

### Diff

Main returns bounded standard unified patches and metadata. The Diff tab lazy-
loads a public `@pierre/diffs` React adapter and maps current filename/theme/
font/wrap/line-number preferences. The API graph has no renderer-to-Main mutation
edge; accept/revert/fingerprints are deleted.

### Composer

Image chooser/paste/drop feeds one in-memory validation/preview helper. At send,
it emits documented base64/MIME `images`. Workspace `@` search performs a
bounded canonical name/path walk, returns file/directory rows, and formats
selected paths into one readable message block. No file content/private context
field or persisted image bytes are added.

Submission clears its captured selections only after official command
acceptance and only when the live draft still matches, preventing concurrent
edits from being erased.

While streaming, the Composer stays editable and presents a stable split submit:
the primary/keyboard action is always Queue through `follow_up`, its menu offers
one-shot Steer through `steer`, and a separate fixed-size Stop invokes `abort`.
The choice to steer is not persisted. A bounded read-only popover groups current-
generation `queue_update.steering` and `queue_update.followUp` entries; after
reconnect, `get_state.pendingMessageCount` is count-only truth until a new queue
event arrives. Official one-at-a-time/all modes are changed with their RPC
commands and then refreshed from `get_state`. PiPilot does not persist, infer,
edit, reorder, cancel, or dequeue individual queue items.

Commands discovered with `source: "extension"` run immediately through
`prompt`, including while streaming, because official RPC does not accept them
through `steer` or `follow_up`. Prompt templates and skills remain eligible
for the normal idle/Queue/Steer routing.

### Optional MCP

Availability is `get_commands` containing `mcp`. The absent Settings state is
always reachable and provides explanation/install-copy/refresh without global
nag or automatic installation. Structured/raw JSONC edit only standard files.

Because `/reload` is a TUI built-in rather than documented RPC, save/refresh
uses controlled process restart, queued after `agent_settled` when busy. TUI-only
panel commands route to Settings; argument-bearing plugin commands remain
official submissions. Adapter/local Pi own MCP connections, auth, status, and
tools.

## Dependencies And Loading

At implementation start recheck registry latest, inspect installed public types,
then add one maintained dependency per capability with pnpm:

- `material-icon-theme` for file assets/mappings;
- `@pierre/diffs` for read-only rendering, lazy-loaded;
- `jsonc-parser` for interoperable MCP JSONC editing.

Do not add Pi runtime SDK dependencies, duplicate icon/Diff/MCP packages, modify
`node_modules`, or commit local symlinks.

## Execution Coordination

Trellis execution uses disjoint ownership for Codex, Claude Code, and Pi agents:

- Codex: nested local-Pi runtime/session/renderer/cleanup sequence;
- Claude Code: sidebar, icon, terminal, and read-only Diff slices;
- Pi: cost, Composer, and optional MCP slices after core contracts stabilize.

Shared-file gates override parallelism: settings changes sequence; Diff service
lands before Composer search; Diff and credential removal finish before embedded
stack cleanup. Each agent receives curated task contexts and must preserve other
agents' and user edits.

## Verification And Rollback

Use deterministic fake Pi for framing/actions/errors, the latest real no-model
Pi for version/plugin verification, focused service/UI tests, Electron workflows,
Electron-only visual inspection, build/chunk checks, and packaged explicit-path launch outside
version-manager PATH. The MCP real smoke uses a disposable server only when the
adapter is present.

Children are coherent revert points. After renderer cutover there is no runtime
fallback toggle; rollback is a code revert. No external old data is migrated or
deleted.
