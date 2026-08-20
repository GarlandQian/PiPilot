# Technical Design

## Architecture

```text
MCP Settings (renderer)
  -> typed MCP config adapter
  -> preload validated IPC
  -> Main McpConfigService
       -> <selectedProject>/.mcp.json
       -> ~/.pi/agent/mcp.json
  -> LocalPiRuntimeHost controlled restart
  -> local pi --mode rpc --approve
  -> optional pi-mcp-adapter
  -> MCP servers
```

The file editor and runtime integration are separate. Main owns filesystem
access and atomic writes; the selected local Pi process owns package discovery,
config merging, auth, MCP connections, tools, and status.

## Availability Contract

The RPC view adapter retains the latest `get_commands` catalog. MCP availability
is true when the catalog contains the adapter's registered `mcp` command. This
does not inspect the user's Agent directory or depend on a package name/version.

Settings always includes `mcp`. When unavailable it renders an unframed empty
state with:

- a statement that MCP alone requires an optional adapter;
- `pi install npm:pi-mcp-adapter` in a read-only command field;
- a copy icon button and a refresh icon button;
- confirmation that other PiPilot features require only Pi.

Refresh performs the normal controlled runtime restart/command refresh. It does
not execute an install. The same state opens when a user invokes a routed MCP
panel command while the adapter is absent.

## File Scope And Shared Contract

The service exposes two explicit scopes:

| Scope | Path |
| --- | --- |
| project | `<explicitlySelectedProject>/.mcp.json` |
| global | `<home>/.pi/agent/mcp.json` |

There are no compatibility reads, fallback targets, migrations, or scans for
other global MCP files. Load returns scope, resolved path, existence, raw text,
parsed server summaries, diagnostics, and a SHA-256 fingerprint of the exact
bytes or a sentinel for a missing file. The renderer never sends arbitrary
target paths; scope is resolved again in Main from the explicitly selected
project and host home. With a
projectless conversation, project scope is unavailable and Main never resolves
the private `userData/general-chat/workspace` as an MCP project target.

Save carries scope, full candidate text, and the expected fingerprint. Main
re-reads the target, rejects a mismatch with a stable conflict code, validates
the candidate, writes a sibling temporary file, and atomically renames it. New
parents are created only for the two resolved targets. An existing file mode is
preserved; a new file uses the repository's normal platform config-file mode.

## JSONC Editing

Add exact production dependency `jsonc-parser@3.3.1`. One shared parser module
owns diagnostics and projections; UI code does not cast arbitrary JSON.

The document remains an open object. `mcpServers`, when present, must be an
object whose values are objects. Structured operations use `jsonc-parser`
edits against paths so comments and untouched fields survive:

- add/rename/remove server;
- replace one server definition;
- edit common transport and lifecycle fields.

The structured editor enforces exactly one of `command`, `url`, or `socket` for
an edited server and types for fields it presents. Unknown fields are displayed
in the server's advanced JSON object and survive updates. Raw mode edits the
entire document and shows parser diagnostics with line/column before save.
Duplicate object keys are rejected because their precedence is ambiguous.

## Settings UX

Use a dedicated Settings page, not nested cards:

- segmented scope control and exact path;
- server list with add/delete icon commands;
- transport segmented control for stdio, HTTP, or socket;
- common fields appropriate to the selected transport;
- collapsible advanced server JSON and a document-level Raw JSON tab;
- validation/conflict status and a `Save & Restart Pi` command.

Dirty state remains local to the page. Scope switching with unsaved edits uses
the existing normal discard confirmation pattern; this is editor correctness,
not a tool approval policy. A conflict keeps the draft and offers reload from
disk. The page never displays a fabricated merged/effective server list.

## Runtime Apply And Command Routing

RPC does not expose built-in TUI `/reload` as a documented command. On an idle
runtime, successful save asks `LocalPiRuntimeHost` to restart the owned child
against the same cwd/session file. The replacement refreshes authoritative
state, messages, commands, stats, catalog, and extension surfaces before
reporting ready.

During an active turn, save succeeds but apply is queued for `agent_settled`;
the UI shows pending status and retains a manual restart action. Stale child
events remain blocked by runtime generation/request correlation.

Exact panel commands that rely on TUI `custom()` are intercepted at the command
submission boundary when `mcp` is detected:

- `/mcp`
- `/mcp setup`
- `/mcp status`
- `/mcp-auth` without a server

They navigate to MCP Settings and are not sent as prompts. `/mcp tools`, `/mcp
prompts`, `/mcp reconnect [server]`, `/mcp enable|disable <server>`, `/mcp
logout <server>`, and `/mcp-auth <server>` remain official command submissions.
Unknown future subcommands are not guessed or intercepted.

## Status And Auth Boundary

The existing extension UI bridge displays `notify` requests and stores keyed
`setStatus` text, including the `mcp` key. The Settings page may present that
text as official adapter status. It does not subscribe to the plugin's private
event bus or parse its cache.

OAuth is initiated only through discovered plugin commands. Authorization URLs,
callbacks, tokens, keyring behavior, logout, and failures remain inside the
plugin/local Pi process. PiPilot neither intercepts nor stores secrets.

## Verification And Rollback

- Unit: JSONC parsing/duplicate detection, comment/unknown-field preservation,
  scope resolution, missing/create, atomic save, stale fingerprint, and errors.
- Renderer: absent disclosure, copy/refresh, scope/dirty/conflict flows, all
  transport forms, raw diagnostics, and command routing.
- Electron: fake RPC command detection plus save/restart/status flows.
- Real local smoke: disposable workspace `.mcp.json`, local deterministic MCP
  fixture, installed adapter reconnect/tool notification without model usage.
- Package: explicit local Pi path loads the optional adapter outside shell PATH.

Rollback removes the page/service/contracts and dependency as one child. It
does not alter MCP files unless the user explicitly saved them through the UI.
