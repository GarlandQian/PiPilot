# Official-First Capability Audit

## Decision Rule

Every current or planned PiPilot capability must have exactly one disposition:

1. **Official Pi**: invoke the latest verified public CLI/RPC/resource contract.
2. **Desktop integration**: retain minimal Electron/UI/filesystem glue only when
   Pi exposes no equivalent desktop contract.
3. **Remove**: delete the capability when Pi does not expose it and it would
   recreate Agent/session/policy semantics.

There is no compatibility disposition. PiPilot supports only the latest Pi
version rechecked for implementation, accepts only its new current app schemas,
and does not inspect, import, convert, delete, or adapt previous PiPilot data.
PiPilot is an Electron-only desktop product: React/Vite remains an internal
renderer toolchain, not a standalone browser deployment or mock product mode.

Planning evidence was checked on 2026-08-08 against the official npm metadata
(`@earendil-works/pi-coding-agent@0.84.1` latest), installed public docs/types,
the current worktree protocol/preload surfaces, and:

- <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md>
- <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md>
- <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md>
- <https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md>

Implementation must recheck the registry latest and installed public contract.

## Agent And Session Capabilities

| Area | Official contract | Final PiPilot disposition |
| --- | --- | --- |
| Agent runtime | local `pi --mode rpc --approve` | Replace Worker, SDK construction, faux mode, supervisor semantics, and copied protocol with the selected local process plus strict JSONL host glue. |
| State and messages | `get_state`, `get_messages`, documented events | Official snapshots/events are the sole Agent truth; keep only transient rendering state. |
| Prompt and images | `prompt` with official image attachments | Use directly; no private attachment or context payload. |
| Mid-turn and queued input | `steer`, `follow_up`, `queue_update`, `get_state.pendingMessageCount`, and queue mode commands/state | Keep the Composer editable. Idle uses `prompt`; running defaults every submit to `follow_up`, with one-shot `steer` and separate `abort`. Show a bounded read-only projection of official queue events/counts and official modes, including images where supported. Do not persist queues or invent item IDs, dequeue, edit, reorder, or per-item cancel behavior. |
| Abort | `abort` | Use directly. |
| Model and thinking | `get_available_models`, `get_state.model`, `set_model`, thinking query/set/cycle | Use full real official Model objects directly. Retain only a bounded searchable desktop picker; remove mock lists/selections, PiPilot credential/model filtering, and rollback policy. Missing Pi means an explicit empty setup state; missing preload stops at root bootstrap. |
| Compaction | `compact`, `set_auto_compaction`, events | Use directly. |
| Automatic retry | `set_auto_retry`, `abort_retry`, events | Use directly. Do not claim manual retry-last-response support. |
| Agent-context shell command | `bash`, `abort_bash`, stream event | Use directly for commands recorded in Agent context. It is not the interactive terminal. |
| New/open | `new_session`, `switch_session`, optional CLI `--session` | Use directly. Remove custom parent-session creation and custom switch semantics. |
| Rename | `set_session_name` for the active official session | Use directly. An inactive row must activate through the controlled official flow before rename. |
| Fork and clone | `get_fork_messages`, `fork`, `clone` | Use directly; remove custom `before`/`at` fork semantics not present in RPC. |
| History/tree | `get_entries`, `get_tree`, `get_last_assistant_text` | Provide official inspection only. Do not synthesize TUI-style in-place tree-node navigation. |
| Session statistics | `get_session_stats` | Sole cost/token/context source; do not estimate from rendered messages. |
| Export | `export_html` | Use official export when exposed in the desktop UI. |
| Session storage | Pi environment/settings/default precedence, organized by cwd | Pass no `--session-dir`. Project cwd is explicitly selected; projectless cwd is `userData/general-chat/workspace`. Learn the actual catalog directory from `get_state.sessionFile`. |
| Session list | No complete RPC list command | Retain one bounded read-only current-format catalog over the exact directory last observed from official state. No transcript writer/database/path inference. |
| Session delete and pin | No RPC command | Remove session delete and session pin persistence/UI. |
| Commands, prompts, skills | `get_commands`, then official slash prompt submission | Use directly. Built-in TUI commands absent from `get_commands` use dedicated RPC actions or remain unavailable. |

## Configuration, Packages, And Extensions

| Area | Official contract | Final PiPilot disposition |
| --- | --- | --- |
| Authentication | selected Pi's auth, providers, settings, and inherited environment | Remove `credentials.json`, Keychain/safeStorage, credential CRUD/tests/UI, and runtime secret injection. Do not read Pi auth files. |
| Packages/extensions/skills/prompts | Pi startup discovery and official `pi install/remove/list/update` CLI | Let local Pi load them. Remove PiPilot resource catalog, enablement persistence, risk metadata, and package manager UI; PiPilot does not install/update packages. |
| Project resources | selected project cwd plus `--approve` | Use official loading. No PiPilot approval, permission, trust, model-safety, environment, or sensitive-file policy. |
| Extension dialogs | RPC `select`, `confirm`, `input`, `editor` requests/responses | Render and correlate directly. |
| Extension surfaces | RPC `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text` | Render directly using official keys/values. |
| TUI-only extension UI | Explicitly unsupported/no-op in RPC | Show official degradation/errors; do not copy component/theme/custom UI protocols. |
| MCP runtime | optional local `pi-mcp-adapter` loaded by Pi | Pi alone remains sufficient for every non-MCP feature. Detect adapter via `get_commands`; Pi/adapter own execution, tools, auth, and status. |
| MCP configuration | adapter's standard project/global JSONC files; TUI setup is unavailable in RPC | Retain the already approved optional settings editor as desktop config glue only. It edits standard files and restarts Pi; it is not an MCP client or plugin manager. |
| General Settings | Main local-Pi executable configuration and probe snapshot | Show actual configured/resolved path, version, state, bounded diagnostic, and choose/clear/retry actions. Remove disabled notification/sound/usage rows. |
| Appearance / language / terminal Settings | Main-owned current AppSettings snapshot | Retain real configurable values/defaults. No web Settings authority or old-schema interpretation. |
| About Settings | Electron Main application information | Show actual app version, platform, architecture, and Electron version. Remove bundled Pi SDK constant and browser-preview fallback. |
| Permissions / Agent Resources / Updates Settings | No retained current owner | Remove these navigation sections and disabled/custom catalog surfaces rather than presenting examples or unavailable controls. |

## Retained Desktop Integration

These capabilities remain custom because the public Pi CLI/RPC does not provide
an Electron desktop contract for them:

| Capability | Why it remains |
| --- | --- |
| Electron-only application bootstrap | Core behavior requires preload/Main access. Require the typed preload bridge before mounting providers; an absent bridge renders only an unsupported-environment state. |
| Executable discovery and process host | The package does not publicly export the documented subprocess JSONL client; Electron must locate, launch, frame, correlate, replace, and stop the selected executable. |
| Project picker and projectless scope | Desktop navigation must choose cwd. Projects come only from the folder picker; the private projectless cwd is not a project. |
| Sidebar and panel layout | Pure desktop navigation/presentation over official session metadata. |
| Read-only session catalog | Required only because RPC has no complete session-list command; Pi remains the only session writer/opener. |
| File tree, preview, and `@` path search | Desktop workspace presentation. Selected paths are appended as normal prompt text so official Pi tools remain the content reader. |
| Interactive terminal | A persistent `node-pty` user shell is different from official RPC `bash`, which runs one command and records it in Agent context. |
| Read-only Git Diff | Pi exposes no desktop Git working-tree Diff renderer. PiPilot keeps bounded reads and removes accept/revert mutation. |
| Icons, brand, typography, localization, retained Settings, windows | Application presentation and Electron lifecycle, with every Settings value mapped to the real owners above. |

## Current Worktree Removal Sweep

The current source exposes custom Agent operations in
`src/shared/agent-protocol.ts`, preload methods in `src/preload/index.ts`, and
implementations across `src/agent-worker`, `src/main/agent`, repositories,
permissions, resource stores, credential stores, and renderer reducers. Before
deleting the old stack, every operation/API must be classified against the tables
above.

Required structural removals include:

- runtime payload fields for `sessionDir`, faux/embedded mode, credentials, and
  resource preferences;
- custom session parent creation, list/history/open/rename/delete/fork position,
  pinning, and transcript schemas where official contracts replace or remove
  them;
- credential, permission/approval, model-safety, resource/risk, environment, and
  sensitive-path policies;
- direct `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` runtime
  dependencies after imports are gone;
- production `WEB_MODELS`, `WEB_SELECTED`, `WEB_CREDENTIALS`, model mock-data
  imports, and PiPilot credential gates around model availability/selection;
- production `mode: 'web'` branches, static mock workspace/messages/resources/
  inspector UI, the localStorage Settings authority, standalone web build/dev
  scripts, and browser-server visual tests. Deterministic fixtures remain only
  under tests and drive Electron through its real preload/Main boundary;
- Diff mutation and unsupported session/resource controls.

## Enforcement Gate

- Every retained Agent-facing button/store/IPC method cites a current official
  RPC/CLI/resource contract.
- Every retained custom module is demonstrably desktop/process/catalog glue and
  cannot decide Agent, session, model, tool, credential, plugin, or policy
  semantics.
- Running input and pending queues map only to official prompt/follow-up/steer/
  abort, queue events/counts, and mode commands. No custom sticky send mode,
  queue persistence, or per-item mutation survives.
- Every visible Settings row/control is backed by Main/AppSettings/official RPC/
  standard MCP data. Unimplemented sections are absent; loading/error/empty state
  never substitutes sample content.
- No private Pi imports, copied clients, bundled fallback, secondary transcript,
  PiPilot session root, old-schema parser, data migration, or startup cleanup
  exists.
- No standalone web runtime, production mock-data import, or web-mode Store branch
  exists. Electron Chromium `sessionData`, renderer localStorage used only as a
  non-authoritative desktop paint cache, and Playwright's Electron/CDP connection
  do not count as web-product support.
- A fresh-state structural audit plus fake/real latest-Pi checks verifies the
  classification before the cutover is complete.
