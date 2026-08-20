# Technical Design

## Architecture And Ownership

```text
PiPilot React presentation / RPC-derived view state
  -> typed Electron preload IPC
  -> Main LocalPiRuntimeHost
       - executable resolution + capability probe
       - strict LF JSONL + request correlation
       - owned child lifecycle + diagnostics
  -> selected local `pi --mode rpc --approve [--session path]`
       - official Agent, models, tools, packages/plugins, sessions, auth

Main ConversationContextService + read-only OfficialSessionCatalog
Optional MCP Settings adapter -> standard config files only
```

PiPilot integration code may launch, correlate, catalog, and present.
It may not decide Agent behavior, create parallel model/tool/session semantics,
load Pi runtime libraries into Electron, or substitute a standalone browser/mock
mode when preload is absent.

## Executable Resolution And Compatibility

Persist an optional absolute `piExecutablePath` in atomic app settings. Resolve
explicit path, inherited PATH, login-shell discovery on macOS/Linux, then
platform command discovery on Windows. Canonicalize and probe `--version`, then
start a no-model RPC process and require documented `get_state`/`get_commands`
responses and the command cohort PiPilot consumes.

Launch with the resolved conversation cwd, normal environment, and
`--mode rpc --approve`; add `--session <absolute path>` when opening directly,
but never `--session-dir`. Pi's flag loads resources for that run. PiPilot never
writes trust or approval state. Missing or non-target versions yield setup
status. Implementation supports only the latest official version rechecked for
that release and its verified command cohort; there is no older-version shim,
speculative future-version support, or bundled fallback.

## Transport And Lifecycle

Decode raw UTF-8 chunks with a retained tail, split only on byte LF, strip one
terminal CR, bound records, and serialize writes as JSON plus LF. Generated
request IDs map one documented response to one pending command. Events,
extension UI requests, stderr, malformed/unknown records, and exit route to
typed status/diagnostics without becoming custom Agent events.

One Main owner holds one active process generation. Replacement rejects new
commands, aborts when appropriate, cancels pending requests/dialogs, terminates
only the owned child, starts the new cwd/session, and hydrates state. All
callbacks carry generation identity so stale output cannot update the new
session. Renderer reload reattaches; it does not spawn another child.

## Conversation Scope And Session Catalog

Resolve project cwd only from explicit folder selection and projectless cwd from
`userData/general-chat/workspace`. Never use home as a project and never pass
`--session-dir`.

Use `dirname(get_state.sessionFile)` as the effective official directory observed
for the activated scope. The catalog reads bounded current-format display
metadata only and delegates every open/switch to local Pi. It never infers Pi's
path encoding, deletes, pins, repairs, migrates, or writes transcript entries.

Credential/permission/resource persistence is removed from source. No startup
code searches for, imports, translates, or deletes old external app data.

## Renderer State And Capability Mapping

The generation-scoped renderer provider initializes from official state,
messages, models/levels, commands, and stats. It assembles only in-flight
documented message deltas and replaces them with authoritative final/snapshot
data. Presentation adapters retain official discriminators/IDs and do not
persist a second transcript.

| PiPilot surface | Official RPC |
| --- | --- |
| Prompt/images | `prompt` |
| Running one-shot direction | `steer` |
| Running queued work | `follow_up` |
| Pending queue projection | `queue_update` / `get_state.pendingMessageCount` |
| Abort | `abort` |
| New/open | `new_session` / Main-owned process replacement with official `--session` |
| Rename | `set_session_name` |
| Fork/duplicate/history inspection | `get_fork_messages`, `fork`, `clone`, `get_entries`, `get_tree` |
| Model list/current | `get_available_models` / `get_state.model` |
| Model selection/thinking | `set_model` plus official thinking query/set/cycle commands |
| Compact/automatic retry | `compact`, `set_auto_compaction`, `set_auto_retry`, `abort_retry` and events |
| Conversation shell execution | `bash`, `abort_bash`; separate from PiPilot's interactive PTY |
| Cost/context | `get_session_stats` |
| Commands | `get_commands`, then slash `prompt` for returned commands |
| Extension dialogs | correlated select/confirm/input/editor requests |
| Extension surfaces | notify/status/widget/title/editor-text requests |

Idle submission maps to `prompt`. During streaming, the Composer remains
editable and its primary/keyboard submit maps to `follow_up` every time; a
split-menu maps one captured submission to `steer` without persisting that
choice. A fixed-size Stop remains a separate `abort`. Detailed steering/follow-
up lists exist only for the active generation after `queue_update`; after
reconnect, only the aggregate pending count is known until another event. Mode
changes use official set commands followed by `get_state` refresh. Because RPC
provides no queue item identity/mutation commands, the bounded queue view is
read-only and not persisted.

Commands returned by `get_commands` with `source: "extension"` run
immediately via `prompt`, even during streaming. Prompt templates and skills may
follow idle/Queue/Steer routing. Unknown slash input is submitted as an ordinary
message and official errors remain visible.

Session delete/pin and credential/resource/approval/risk actions have no
retained custom mapping. TUI-only `custom()`/component/theme APIs stay upstream-
degraded. Renderer model rows are bounded desktop presentation over full official
Model objects; no mock list, credential gate, or parallel model policy remains.

## Local Packages, Plugins, And Optional MCP

Pi's startup loader discovers its global Agent directory and project resources.
PiPilot does not parse package manifests, install packages, or persist generic
enablement. External package changes are applied by controlled process restart,
then state/messages/commands/stats/catalog refresh.

With no extension installed, all built-in RPC and PiPilot desktop behavior
remains ready. Installed extension commands and supported UI are additive.

MCP is one optional extension case. The sibling Settings task detects adapter
presence from the official `get_commands` result, clearly discloses absence, and
may edit only the standard project/global MCP JSONC files after explicit user
save. It does not make PiPilot an MCP client or restore risk/approval policy.

## Cleanup Boundary

After renderer cutover, delete the Worker, Main semantic supervisor, custom
Agent protocol/reducer, credential/permission/model-safety/resource-risk stacks,
sensitive path/environment policy, Diff mutation fingerprints, unsupported UI,
old build inputs, and unused direct Pi dependencies.

The same cleanup removes web-mode Store/adapter unions, production static mock
data, standalone web scripts/tests, disabled Settings placeholders, the custom
resource/permission/update navigation, credential forms, and hard-coded Pi SDK
version display. Retained Settings consume the owning Main/RPC/config contracts.

Retain JSONL/process host, official view projection, catalog, optional
MCP config adapter, canonical workspace containment, bounded reads, atomic
surviving app persistence, desktop features, and required Electron application
plumbing.

## Verification And Rollback

Use deterministic fake Pi tests for framing/lifecycle, the latest real no-model
local Pi for version/plugins, Electron for supported workflows, and packaged
explicit-path startup outside fnm PATH. Children land as coherent slices; after
renderer cutover rollback is commit revert, not a runtime fallback switch.
