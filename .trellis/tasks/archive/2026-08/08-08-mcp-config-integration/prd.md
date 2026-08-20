# Integrate Standard MCP Configuration Through Local Pi

## Goal

Provide a discoverable, first-class editor for interoperable MCP configuration
while keeping the local Pi executable as PiPilot's only mandatory external
installation and keeping all MCP execution inside an optional installed
`pi-mcp-adapter`.

## Background

- Official Pi core intentionally has no built-in MCP implementation.
- The user's local Agent directory contains `pi-mcp-adapter@2.20.1`; npm reported
  `2.21.0` as latest on 2026-08-08.
- Both versions use TUI-only `ctx.ui.custom()` for `/mcp`, `/mcp setup`, and the
  no-argument OAuth picker. Official Pi RPC 0.84.1 returns `undefined` for
  `custom()`, so those plugin panels cannot be hosted by PiPilot and can remain
  pending in their current wrappers.
- The adapter consumes MCP configuration from Pi's Agent directory and project
  files. PiPilot uses exactly global `~/.pi/agent/mcp.json` and project
  `.mcp.json`; it does not expose the adapter's other discovery layers.
- Tools, prompts, providers, notifications, status, reconnect, named OAuth, and
  MCP execution can otherwise run inside the selected local Pi process.

## Requirements

### Optional integration and disclosure

- Pi remains the only mandatory external installation. No non-MCP feature may
  check for or depend on `pi-mcp-adapter`.
- Keep an MCP entry visible in Settings. Detect the optional adapter from
  official `get_commands`; do not scan package directories or import its code.
- When it is absent, show a non-blocking empty state stating that only MCP needs
  the optional adapter and all other PiPilot features remain available. Include
  the official `pi install npm:pi-mcp-adapter` command, a copy button, and a
  refresh action.
- Do not install, update, enable, or remove the adapter automatically. Do not
  show a global startup warning to users who never open or invoke MCP.
- An attempted `/mcp` affordance while absent routes to the same explanatory
  Settings state instead of failing as an Agent request.

### Standard configuration editor

- Edit only project `.mcp.json` and user-global `~/.pi/agent/mcp.json`. Show
  the active scope and exact path; do not claim these two files are the complete
  merged effective configuration.
- Project scope exists only for the exact directory explicitly selected through
  the project folder picker. Projectless conversations expose global scope only;
  never create/read `.mcp.json` under `userData/general-chat/workspace` or treat
  that private cwd as a project.
- Support named stdio, Streamable HTTP/SSE, and Unix-socket server entries with
  structured common fields and a raw JSONC mode for the complete document.
- Use `jsonc-parser@3.3.1`, latest verified during planning, so structured edits
  retain comments, formatting where practical, and unknown top-level/server
  fields without importing `pi-mcp-adapter` internals.
- Validate JSONC syntax, unique server names, object shapes, and the edited
  transport invariant before saving. Invalid content leaves disk unchanged.
- Load returns a content fingerprint. Save rechecks it and reports an external
  change instead of overwriting; successful writes use a temporary sibling file
  and atomic rename.
- Allow the adapter's ordinary literal values and environment/command references.
  PiPilot adds no secret store, Keychain integration, risk scan, approval gate,
  credential migration, or private MCP preference document.

### Local Pi application

- Official RPC documents that built-in TUI commands such as `/reload` are not
  returned by `get_commands` and do not execute when sent as a prompt. After
  save, apply through a controlled local Pi restart preserving the active
  workspace/session, then refresh state, messages, commands, stats, and the
  session catalog.
- If a turn is active, save atomically and mark the configuration pending; apply
  after the turn settles or when the user explicitly restarts the runtime.
- When the adapter is detected, route the TUI-only `/mcp`, `/mcp setup`, `/mcp
  status`, and no-argument `/mcp-auth` affordances to this Settings surface.
  Argument-bearing RPC-compatible commands remain discoverable and run through Pi.
- Display official extension notifications and keyed MCP status text. Do not
  synthesize per-server live status or connect to an MCP server from PiPilot.
- Named OAuth remains plugin-owned. PiPilot may invoke the discovered
  `/mcp-auth <server>` command but never handles or persists its tokens.

## Acceptance Criteria

- [ ] With only Pi installed, PiPilot's complete non-MCP workflow is available
      and the MCP page clearly describes the optional dependency without a
      global warning.
- [ ] The absent state shows the official install command, copy and refresh
      actions, and becomes ready after the local Pi process detects the adapter.
- [ ] A user can add equivalent stdio, HTTP, and socket entries at project or
      global scope and apply them to the selected local Pi process.
- [ ] Projectless Settings offers global scope only, while project scope resolves
      exactly to the user-selected project and never to the private projectless cwd.
- [ ] Structured editing preserves comments and unknown fields; raw JSONC can
      express the adapter's complete current or future schema.
- [ ] Malformed, duplicate, transport-invalid, or externally changed config
      cannot overwrite the existing file; successful writes are atomic.
- [ ] Save plus controlled restart refreshes commands/status, and a disposable local
      MCP fixture can reconnect and expose its tool metadata through the adapter.
- [ ] TUI-only MCP affordances cannot strand the RPC session; they open Settings,
      while RPC-compatible argument-bearing commands still execute through Pi.
- [ ] No PiPilot MCP runtime/client, package manager, risk/approval system,
      credential repository, adapter source import, or duplicated live status
      model exists.
- [ ] Focused unit, renderer, Electron, typecheck, build, and packaged explicit-
      Pi-path checks pass; any real-plugin smoke result is reported accurately.

## Out Of Scope

- Making MCP available without an installed adapter.
- Installing, updating, removing, vendoring, or silently configuring Pi packages.
- Reimplementing the adapter's MCP transports, proxy/direct tools, metadata
  cache, OAuth storage, approvals, output guards, MCP UI viewer, or TUI panels.
- Editing or silently importing Cursor, Claude, Codex, VS Code, Windsurf, or
  other host-specific configuration files.
- Editing any other adapter-discovered global file, project `.pi/mcp.json`, or
  adapter-owned cache/auth files.

## Dependency And Ownership

This child depends on the local Pi RPC host, official command discovery,
extension notification/status handling, and controlled restart behavior.
It owns the standard-file Main service, typed IPC/preload adapter, MCP Settings
surface, TUI-command routing, and focused tests. It does not own MCP execution.
Its SettingsLayout handoff lands before the legacy/web/mock cleanup child performs
the final navigation sweep.

## Risks And Deferred Items

- `get_commands` proves command registration, not adapter version; the UI reports
  detected/not detected without inventing a version.
- Other config layers may override the two editable files. The initial UI shows
  scope/path and official diagnostics rather than reproducing adapter merging.
- Plugin OAuth uses plugin-selected storage. Users who do not want that behavior
  can configure environment/header/bearer references; PiPilot does not replace it.
