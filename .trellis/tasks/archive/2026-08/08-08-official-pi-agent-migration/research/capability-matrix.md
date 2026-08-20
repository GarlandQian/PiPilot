# Local Pi RPC Capability Matrix

## Selected Endpoint

PiPilot selects the user's local `pi --mode rpc` executable. On 2026-08-09 the
official npm `latest` package remained `@earendil-works/pi-coding-agent@0.84.1`;
the user's discovered local executable was also `0.84.1`.

Primary evidence:

- <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md>
- <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md>
- installed package docs/types and the 0.84.1 npm metadata/export map, rechecked
  against the npm registry on 2026-08-09

The package does not publicly export its subprocess `RpcClient`. The minimal
PiPilot JSONL/process adapter therefore uses only documented envelope/framing
contracts and is host glue, not a new Agent protocol.

## Capability Disposition

| Capability | Official RPC 0.84.1 | PiPilot disposition |
| --- | --- | --- |
| Product runtime | Pi requires local process/filesystem integration | Electron only; Vite/React is an internal renderer, with no standalone browser mode or production mock fallback |
| Prompt / images | `prompt` | Keep |
| Mid-turn direction | `steer`, `set_steering_mode` | Keep as an explicit one-shot action; never make it the persisted running-submit default |
| Post-turn queue / images | `follow_up`, `set_follow_up_mode` | Restore as the primary running-submit Queue action, including official images |
| Pending queue state | `queue_update`, `get_state.pendingMessageCount` | Keep a generation-scoped read-only projection; reconnect state is count-only until the next queue event, with no custom item mutation or persistence |
| Abort | `abort` | Keep |
| New/open session | `new_session`; `switch_session` is documented but PiPilot opens catalog rows through Main-owned process replacement with `--session` | Keep with the Main-owned open path |
| Session list | No list command | Read-only official session metadata catalog |
| Rename | `set_session_name` | Restore |
| Fork / duplicate / tree inspection | `get_fork_messages`, `fork`, `clone`, `get_tree`, `get_entries` | Restore; no in-place tree-node navigation claim |
| Delete session | No command | Remove |
| Pin session | No command | Remove custom persistence |
| Model / thinking | `get_available_models`, `get_state.model`, `set_model`, thinking query/set/cycle | Use real configured models only; bounded desktop picker is presentation, while PiPilot mock lists, credential gates, and model policy are removed |
| Manual compaction | `compact` | Restore |
| Auto compaction / automatic retry | official mode commands/events | Keep |
| Bash in Agent context | `bash`, `abort_bash` | Keep; do not conflate with interactive PTY terminal |
| State / messages | `get_state`, `get_messages` plus events | Official renderer source |
| Usage / cost | `get_session_stats` | Keep; authoritative totals |
| Commands / skills / prompts | `get_commands`, slash prompt expansion | Keep |
| Export HTML | `export_html` | Available through official command; UI may remain secondary |
| Extension dialogs | select/confirm/input/editor protocol | Restore |
| Extension notices/status/widgets/title/editor text | fire-and-forget protocol | Restore |
| Custom TUI component/theme APIs | Explicitly unsupported/degraded | Do not emulate |
| Credentials | Local Pi `auth.json`/providers | Remove PiPilot ownership |
| Packages/extensions/skills/prompts | Local Pi resource loader/config | Keep as optional local-Pi resources; remove generic PiPilot catalog/UI |
| MCP | Optional `pi-mcp-adapter`; no Pi core MCP | Always-visible disclosure + standard config editor in sibling task; no core dependency/risk layer |
| Tool approval/model safety/MCP risk | No equivalent Pi policy | Remove |
| Project-local package trust in RPC | Official `--approve` per-run override | Pass on PiPilot launches; do not persist PiPilot rules |
| Package refresh | No documented RPC reload command | Controlled process restart, then refresh commands/state |
| Baseline RPC/persistence/catalog correctness | Required by the retained desktop integration | Keep correlation, atomic surviving writes, bounded reads, and Pi-owned session discovery |

## Retained Custom Code Test

A surviving PiPilot module is valid only when:

1. it is required to launch/connect a local process, list known official session
   metadata, bridge Electron IPC, or present official state;
2. it does not create a different Agent command, transcript, policy, or persisted
   Pi configuration; and
3. removing it would make local Pi integration or desktop presentation
   impossible.

This permits executable discovery, strict JSONL/correlation, process lifecycle,
read-only session metadata, official-event view mapping, extension UI dialogs,
and typed project/projectless cwd resolution. It rejects old-data migration,
the old Worker protocol, approval
state, model/resource policies, credential store, and parallel reducers.

## Data Boundary

| Data | Final rule |
| --- | --- |
| local Pi `~/.pi/agent` (or configured Agent dir) | Used unchanged by local Pi |
| Pi sessions | PiPilot passes cwd and optional session file, never `--session-dir`; actual catalog directory comes from `get_state.sessionFile` |
| PiPilot `credentials.json` | Remove product path/repository/API/UI; do not inspect old external files |
| PiPilot `permissions.json` | Remove product path/repository/API/UI; do not inspect old external files |
| PiPilot `resource-preferences.json` | Remove product path/repository/API/UI; do not inspect old external files |
| old PiPilot session JSONL | Unsupported and untouched; no import/copy/delete/compatibility path |
| PiPilot app/workspace/terminal settings | Support only the new current schema with local Pi executable and terminal controls; no earlier-schema migration |
| Settings presentation | General/AppSettings/Models/Terminal/MCP/About use their real Main/RPC/config sources; remove permission/resource/update/credential placeholders and hard-coded Pi runtime data |

## Extension UI Limits

RPC reports `ctx.mode = "rpc"` and `ctx.hasUI = true` for supported dialog and
fire-and-forget methods. It explicitly degrades `custom`, working/header/footer,
custom editor component, tools-expanded, editor reads, and theme APIs. PiPilot
must report that upstream boundary rather than adding private side channels.

## Version And Packaging

- No bundled Pi dependency is the runtime source of truth.
- No standalone web build/runtime is supported; missing preload cannot enter
  application providers or substitute mock Agent/workspace state.
- Version/status UI shows the actual local executable.
- Package tests launch with an explicit executable path and without relying on
  fnm/PATH inheritance.
- The latest verified version plus a no-model handshake and fixture extension
  verifies the current CLI contract; older or unverified newer releases do not
  receive compatibility shims.
