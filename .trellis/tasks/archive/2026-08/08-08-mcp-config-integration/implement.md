# Implementation Plan

## 1. Add The Open JSONC Contract

- Add exact `jsonc-parser@3.3.1` with pnpm and preserve `pnpm-lock.yaml`.
- Define shared scope, load/save snapshot, diagnostics, server projection, and
  stable error schemas.
- Implement one parser/projection module with duplicate-key and edited-transport
  validation plus comment-preserving structured edits.

## 2. Implement Main File Ownership

- Add `McpConfigService` with exact selected-project `.mcp.json` and
  `<home>/.pi/agent/mcp.json` resolution; reject project scope for projectless
  conversations and never target their private cwd or any alternate global
  file.
- Implement missing-file snapshots, exact-byte fingerprints, expected-
  fingerprint conflicts, sibling temporary writes, mode preservation, rename,
  and cleanup.
- Register validated IPC, preload methods, renderer adapter, and Main lifecycle
  composition without accepting renderer-supplied paths.

## 3. Build Optional-Dependency UX

- Add the MCP Settings navigation/page and localization.
- Bind adapter availability to official `get_commands` state.
- Implement the absent state, install-command copy action, refresh detection,
  and non-blocking message that all non-MCP features remain available.
- Ensure no startup/global warning and no package filesystem scan exists.

## 4. Build Configuration Editing

- Add project/global segmented scope, exact path, server list, add/remove, and
  transport-specific forms.
- Add server advanced JSON and full raw JSONC editing with inline diagnostics.
- Preserve local drafts across validation failures, block stale saves, and
  handle scope changes/conflicts without losing edits.

## 5. Apply Through Local Pi

- Add idle controlled restart and queued restart-after-settle through the RPC
  host; do not submit the TUI-only built-in `/reload` as an RPC prompt.
- Refresh state/messages/commands/stats and present official extension
  notifications/keyed status.
- Route exact TUI-only MCP panel commands to Settings; leave RPC-compatible commands
  on official prompt handling.

## 6. Verify The Child

After all related edits, run focused existing/new checks, expected to include:

```bash
pnpm test:unit -- tests/unit/mcp-config-service.test.ts tests/unit/mcp-config-parser.test.ts tests/unit/ipc-contracts.test.ts
pnpm typecheck
pnpm test:electron -- --grep "MCP configuration"
pnpm build
pnpm package:dir
```

Run a real local-Pi smoke with a disposable workspace and deterministic local
MCP server only when the adapter is available. Report it as skipped rather than
passing when unavailable.

## Dependencies And File Ownership

This child starts after the local RPC command/status/restart contracts stabilize.
It owns MCP config schemas/parser/service/IPC/preload/adapter, Settings UI/locales,
command routing, dependency/lockfile edits, and focused tests. It does not edit
the plugin installation, Agent directory config, MCP runtime, credential store,
or unrelated settings. Coordinate the shared SettingsLayout once, then hand it to
the later legacy/web/mock cleanup task for final navigation removal.

## Pre-Start Gate

- Parent local-RPC task exposes command discovery, extension notify/status, and
  restart preserving workspace/session.
- Optional adapter disclosure and standard-file-only ownership remain intact.
- `implement.jsonl` and `check.jsonl` validate.
- The umbrella final planning summary receives fresh implementation approval.
