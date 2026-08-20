# Pi MCP Adapter RPC Compatibility Research

## Versions Checked

- Local package: `pi-mcp-adapter@2.20.1`.
- npm latest on 2026-08-08: `2.21.0`.
- Local Pi: `0.84.0`; planning target: Pi `0.84.1`.

## Authoritative Sources

- Local installed `pi-mcp-adapter` package README, package metadata, and command
  implementation.
- Upstream repository: <https://github.com/nicobailon/pi-mcp-adapter>.
- Upstream current package metadata and `commands.ts` on 2026-08-08.
- Official Pi RPC documentation at
  `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`.

## Config Contract

The adapter can discover several config layers, but PiPilot deliberately owns
only two editor targets: global `~/.pi/agent/mcp.json` and project `.mcp.json`.
It does not scan, migrate, read, or write alternate global paths or project
overrides. Server definitions support stdio `command`/`args`, HTTP `url`, Unix
`socket`, environment/header fields, lifecycle/timeouts, tool filters, direct
tools, auth options, and extension fields. A forward-compatible editor must
preserve fields it does not understand.

## RPC Compatibility

Pi RPC carries `select`, `confirm`, `input`, `editor`, `notify`, `setStatus`,
`setWidget`, `setTitle`, and `set_editor_text`. It explicitly returns
`undefined` for `ctx.ui.custom()`.

Current adapter `/mcp`, `/mcp setup`, and no-argument `/mcp-auth` call
`ctx.ui.custom()` inside promises that resolve only from the TUI callback. RPC
does not run that callback, so the custom panels are unavailable and the command
can remain pending. This behavior is still present in upstream 2.21.0.

Argument-bearing operations such as `/mcp tools`, `/mcp prompts`, `/mcp
reconnect <server>`, `/mcp enable|disable <server>`, and `/mcp-auth <server>` use
ordinary extension notifications/status or remote/headless auth behavior and do
not require PiPilot to host an MCP client. MCP tools/providers register directly
with the official local Pi session.

## Recommended Boundary

Use only `~/.pi/agent/mcp.json` and project `.mcp.json` as the integration
contract. PiPilot may provide a structured/raw editor and atomic
write/controlled-restart UX, but must not import adapter internals, own MCP
connections, copy the TUI panel, or persist parallel config.
If no in-app editor is approved, expose the detected paths and open an external
editor/terminal; the TUI panels still cannot be used through RPC.
