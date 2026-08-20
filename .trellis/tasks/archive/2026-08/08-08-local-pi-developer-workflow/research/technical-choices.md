# Technical Choice Research

## Evidence And Versions

Research was refreshed on 2026-08-08 against the worktree, installed package
docs/types/source, official npm metadata, and upstream primary sources:

- Pi RPC: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md>
- Pi coding-agent README: <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md>
- Pi Web: <https://github.com/agegr/pi-web>
- Material Icon Theme: <https://github.com/material-extensions/vscode-material-icon-theme>
- Pierre Diffs: <https://diffs.com>
- pi-mcp-adapter: <https://github.com/nicobailon/pi-mcp-adapter>

Latest registry values verified during planning:

| Package | Version |
| --- | --- |
| `@earendil-works/pi-coding-agent` | `0.84.1` |
| `material-icon-theme` | `5.37.0` |
| `@pierre/diffs` | `1.3.5` |
| `pi-mcp-adapter` | `2.21.0` |
| `jsonc-parser` | `3.3.1` |

The Pi registry and local fnm executable were rechecked on 2026-08-09: both are
`0.84.1`. The earlier optional MCP adapter observation was `2.20.1`; other
package values in this table were not re-queried by that Pi-only recheck.
PiPilot itself does not mutate the user's global installation.

## Runtime Alternatives

| Alternative | Exact local CLI/plugin version | Custom host work | Decision |
| --- | --- | --- | --- |
| PiServer/PiClient remote protocol | No; executes bundled package cohort | Server + MessagePort adapters | Rejected |
| Embedded `AgentSession` SDK, like Pi Web | Shares Agent directory but executes bundled SDK | Session/UI/extension manager | Rejected |
| Local `pi --mode rpc --approve` | Yes | Minimal process/JSONL/UI bridge | Selected |

Pi Web uses Next.js routes/SSE around an embedded pinned `AgentSession`; it can
share `~/.pi/agent` but does not execute the user's selected CLI. PiPilot may
reuse presentation ideas only.

## Product Platform Choice

PiPilot supports Electron only. The React/Vite output is an Electron renderer,
not a separately supported website. A standalone browser cannot launch the
selected local Pi process, provide the persistent `node-pty` terminal, or use the
canonical project/Git/file services behind Main/preload. Remove `dev:web`,
`build:web`, web-mode Stores, production static mock UI, and the Vite web-server
visual suite. Visual checks launch Electron with deterministic test fixtures.

The root renderer requires the typed preload bridge before providers mount. A
direct browser load may show only an unsupported-environment error and exposes no
mock app. Electron's Chromium `sessionData`, a non-authoritative pre-paint cache,
and Playwright connecting to Electron are desktop internals, not web support.

## Public Export And Framing Constraint

Pi `0.84.1` exports `.`, `./client`, and `./rpc-entry`. `./client` is the
experimental remote protocol, not the documented JSONL subprocess client, and
the internal `RpcClient` is not a public package export. PiPilot therefore
implements only documented LF framing, request correlation, process lifecycle,
IPC, and presentation glue. It does not copy upstream source or import private
`dist/` paths.

Official docs require strict LF records; generic Node `readline` also recognizes
Unicode separators and is unsuitable. The adapter retains partial UTF-8 chunks,
splits only on LF, strips optional CR, and treats unknown/malformed envelopes as
visible protocol diagnostics.

## Capability Boundary

RPC supports prompt/steer/follow-up with images, abort, new/switch, state/
messages/models/thinking, queue modes, compaction/automatic-retry controls,
bash, stats, export, rename, fork/clone/tree inspection, command discovery,
extension dialogs, and extension notify/status/widget/title/editor-text
requests. These capabilities are retained or restored.

RPC exposes tree/entry reads plus fork/clone, but no command for TUI-style
in-place navigation to an arbitrary tree node and no manual retry-last-response
command. PiPilot does not synthesize those semantics.

RPC has no full session list, delete, pin, credential/resource CRUD, custom
approval/model-safety/MCP-risk policy, or TUI `custom()`/component/theme support.
PiPilot adds a read-only session catalog but removes the other parallel features.

## Running Input Choice

Idle Composer submission uses official `prompt`. While the Agent is running, the
Composer stays editable and its primary button plus keyboard submit always use
`follow_up` as Queue. A split-menu offers `steer` for that submission only,
without changing the next submission's default, and a separate Stop uses
`abort`. Text, images, and workspace-context references form one captured
submission and clear only after the selected official command is accepted.

`queue_update` is the only detailed queue source. The renderer may show its
`steering` and `followUp` strings in a bounded grouped read-only popover for
the current process generation. After reconnect, `get_state.pendingMessageCount`
supports only an aggregate count until a new queue event arrives. Steering and
follow-up one-at-a-time/all modes use their official set commands followed by a
`get_state` refresh. RPC exposes no queue item IDs or dequeue/edit/reorder/
per-item-cancel command, so PiPilot adds none and does not persist queue bodies.

`get_commands` source controls slash-command routing. Extension-source commands
must run immediately through `prompt`, including while streaming, because Pi
does not accept them through `steer` or `follow_up`. Prompt templates and
skills can use the normal idle/Queue/Steer route; unknown slash input remains an
ordinary official message.

## Conversation And Session Storage Choice

A project exists only after explicit folder selection and uses that canonical
directory as cwd. Projectless chat uses `userData/general-chat/workspace`; it is
never listed as a project. PiPilot passes no `--session-dir` for either scope, so
the selected local Pi applies its environment/settings/default session storage.
Main learns the actual per-scope catalog directory from
`get_state.sessionFile` after activation instead of hard-coding Pi's root or cwd
encoding. There is no old PiPilot session migration.

Built-in TUI commands are not returned by `get_commands` and do not execute when
sent as RPC prompts. In particular, PiPilot applies externally changed packages
or MCP files by controlled process restart, not a fictitious `/reload` RPC.

## Optional Plugin And MCP Boundary

Local Pi is the only mandatory external installation. Global/project plugins
are additive and load through normal Pi startup; no plugin is required for chat,
sessions, files, terminal, Diff, Composer, or other non-MCP behavior.

Pi core has no built-in MCP. MCP Settings remains visible and detects the
optional adapter by the official `mcp` command. If absent, it explicitly says
only MCP requires the adapter, shows `pi install npm:pi-mcp-adapter`, copy, and
refresh; it never installs automatically or warns globally.

The adapter's `/mcp`, setup/status panel, and no-arg auth picker rely on TUI-only
`custom()`. PiPilot routes those entrypoints to a standard-file editor for only
project `.mcp.json` and global `~/.pi/agent/mcp.json`. Local Pi/adapter still
own connections, tools, auth, status, and RPC-compatible argument-bearing commands.

## Cost Choice

`get_session_stats` returns full-session token totals, scalar cost, and nullable
context usage including tools, compaction, and branch summaries. It is the sole
cost/context source; summing visible messages would be incomplete.

## Icon Choice

Current general UI icons consistently use Tabler through `react-icons/tb`.
Retain it for actions/navigation/status. Material Icon Theme supplies maintained
filename/extension/folder mappings and assets as one specialized file theme.
The PiPilot `pi` mark remains the canonical renderer/Electron brand. Generated
assets are regular files/build output, never committed local symlinks.

## Terminal Choice

Current xterm already supports live option updates/refit but shares general code
font settings and has no explicit CJK fallback. Add dedicated terminal font
family/size fields directly to the single current settings schema and append
cross-platform CJK fallbacks. Do not interpret earlier settings, bundle fonts,
or recreate the PTY for typography changes.

## Diff Choice

`@pierre/diffs` provides a maintained public React `PatchDiff`, React 19 support,
syntax themes, wrapping, and read-only operation. Use unified layout in the
narrow inspector and lazy-load its Shiki-heavy renderer. Delete accept/revert,
mutation services, parsed row DTOs, and fingerprints rather than enabling review
annotations.

## Composer Choice

Official RPC images are the paperclip payload. Guarantee PNG/JPEG and send exact
base64/MIME objects on prompt/steer/follow-up. Arbitrary file attachment is not
an official RPC contract.

`@` searches canonical workspace file/directory names and appends one readable
path-reference block to the message. It does not inline contents or add a private
RPC field; local Pi's official tools inspect referenced paths.

## Implementation Dependency Graph

```text
local Pi RPC host
  -> project/projectless scope + Pi-owned session catalog
  -> renderer official state/actions/extensions
       -> cost
       -> Composer images/context
       -> optional MCP settings/detection
       -> credential ownership removal

sidebar | Material icons | terminal settings | read-only Diff
       \__________________________________________/
                          -> embedded Agent cleanup
                          -> cutover verification
                          -> umbrella integration/package gate
```

Diff finishes before embedded Agent cleanup because both remove mutation/fingerprint
code. Composer follows Diff when both touch WorkspaceContentService. Terminal,
runtime executable settings, and MCP coordinate sequentially on shared Settings
files.
