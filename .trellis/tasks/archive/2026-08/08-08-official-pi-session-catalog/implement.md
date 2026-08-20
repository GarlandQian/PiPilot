# Implementation Plan

## 1. Define Current Scope Contracts

- Add the discriminated project/projectless scope and bounded session-summary,
  cursor, and opaque-selection schemas.
- Add one Main resolver for the exact project and projectless cwd; never accept
  renderer paths or infer a project.
- Add a disposable per-scope observed-directory repository populated only from
  official `get_state.sessionFile`; do not predict Pi's directory layout.
- Treat missing `get_state.sessionFile` as typed activation-unavailable and
  persist only current-version observed-directory metadata for inactive-scope
  navigation.
- Update current IPC/preload types directly with no old-schema adapter.

## 2. Build The Read-Only Catalog

- Implement direct-file enumeration with fixed 200-entry, 8-MiB-per-file,
  64-MiB-per-refresh, 8-reader, and 50-row bounds. Stream each admitted current
  v3 file through EOF so the latest appended name is read.
- Canonicalize and compare every header cwd with the resolved scope cwd before a
  row or selection token can be returned.
- Add deterministic sorting, cursor continuation, per-scope invalidation, typed
  diagnostics, stale-token identity checks, and final containment validation.
- Keep the catalog free of create/write/copy/rename/delete/pin/migration APIs.

## 3. Connect Official Pi Selection

- Resolve a selected row in Main, then replace the local Pi process with exact
  scope cwd/session-file inputs and no `--session-dir` override.
- Require official startup state to confirm the active session before renderer
  hydration, then refresh the observed directory from `sessionFile`.
- Invalidate after successful official new/name/fork/clone command responses,
  `agent_settled`, `session_info_changed`, and extension `entry_appended`; do not
  listen for undocumented session lifecycle events.

## 4. Connect Consumers

- Expose lazy project catalog and bounded projectless recent-chat queries to the
  renderer Store.
- Hand the typed contracts to projectless chats and the Codex-style sidebar.
- Remove all old state-migration references, tests, manifests, and task wiring.

## 5. Verify

Run the smallest relevant checks after all edits:

```bash
pnpm test:unit -- tests/unit/official-pi-session-catalog.test.ts tests/unit/conversation-scope.test.ts tests/unit/local-pi-runtime-host.test.ts
pnpm typecheck
pnpm test:electron -- --grep "project session catalog|projectless recent chat"
pnpm build
```

Review malformed/current fixture limits, symlink/traversal/stale-token handling,
never-loaded scopes, exact runtime argv/cwd, Pi setting/environment override
behavior, absence of old paths/migration code, and real latest-Pi session open
evidence.

## Ownership And Rollback

This child owns the scope resolver, read-only catalog, catalog IPC/preload
contracts, and focused fixtures. Runtime process framing stays with the runtime
child; sidebar rendering stays with the sidebar child. Shared files land through
an explicit handoff. Rollback is a code revert before release.
