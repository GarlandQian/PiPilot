# Technical Design

## Deletion Principle

A legacy module is deleted only after its production caller uses local RPC or a
retained desktop service. No compatibility flag, dormant fallback, embedded Pi
runtime, or alternate Agent semantic path remains. Type errors and repository
searches expose stale callers before dependency/build cleanup.

## Ownership Inventory

### Delete

- `src/agent-worker` runtime orchestration, transcript, permission, model-safety,
  and resource/risk modules;
- legacy Main Agent supervisor behavior and old Worker process lifecycle;
- custom Agent semantic request/event/transcript types and adapters;
- legacy renderer message reducer/store and approval integration;
- credential repository/crypto/UI remnants after the credential child;
- permission policy/repository/service, approval types/UI, and persisted state;
- resource preference repository, custom package/resource catalog, risk/MCP
  scanning, enablement UI, and persisted state;
- Agent-specific process-environment filtering and workspace sensitive-path
  hiding;
- Diff accept/revert patch records, hashes/fingerprints, mutation IPC, and limits
  needed only by mutation;
- unsupported session delete/pin code and tests;
- standalone web scripts/config, browser-server visual tests, web Store/adapter
  branches, production `src/data/mock`, and static App/Inspector fixtures;
- localStorage Settings authority, disabled General/Updates/Permissions/Agent
  placeholders, credential Settings, hard-coded Pi SDK/About fallback, stale
  locale keys, old Worker build input, active claims, and direct Pi SDK
  dependencies.

### Retain

- Main local executable discovery/probe, strict JSONL transport/correlation,
  child lifecycle, diagnostics, and typed preload bridge;
- renderer official-RPC snapshot/event projection and supported extension UI;
- read-only current-format official session catalog;
- official RPC-supported rename/fork/clone, entries/tree inspection, compact,
  automatic-retry controls, follow-up/modes, commands, and bash;
- optional MCP adapter detection/disclosure and standard JSONC config editor;
- workspace selection/storage, canonical containment, file tree/context/preview,
  terminal, read-only Git Diff, appearance/settings, icons/brand, localization,
  and Electron application/window/protocol plumbing;
- atomic persistence for surviving app state and generation/session guards;
- Electron Chromium `sessionData`, Electron/Playwright test transport, test-only
  deterministic fake Pi/data fixtures, and an optional non-authoritative
  current-snapshot pre-paint cache.

## Capability Sweep

Search by files, imports, schema discriminators, IPC channels, preload members,
store methods, actions, UI labels, shortcuts, mocks, test names, and active docs.
Classify every hit using the parent capability matrix.

Explicitly preserve matches for:

```text
rename, fork, clone, get_entries, get_tree, compact, set_auto_retry,
abort_retry, bash, abort_bash, follow_up, steering/follow-up mode, get_commands,
get_session_stats, extension_ui_request
```

Explicitly remove product matches for:

```text
session delete/pin, credential CRUD/test, resource CRUD/toggle/risk,
permission/approval, model safety, MCP risk, sensitive path/env policy,
Diff accept/revert/fingerprint, embedded Worker/Pi SDK,
web mode, dev:web, build:web, LocalStorageSettingsAdapter, src/data/mock,
VITE_PIPILOT_VISUAL_TEST, PI_RUNTIME_VERSION, browser preview
```

An `rg` match is reviewed in context rather than blindly requiring zero when a
term has a retained unrelated meaning.

## Fresh-State Persistence Removal

Credential ownership is removed by its child. This child deletes the
`permissions.json` and `resource-preferences.json` path constants, repositories,
schemas, startup composition, tests, and product copy. No replacement state file
or compatibility layer is introduced, and no runtime code searches for or
mutates old external app data or official Pi configuration.

## Workspace And Environment Simplification

The local Pi process receives the normal inherited environment. Remove
`createUnprivilegedProcessEnvironment` and custom secret-name/URL filtering from
the Agent launch and any retained read-only Git command path unless a standard
platform requirement independently needs a narrow variable override.

The workspace service stops hiding `.env`, auth, credential, and key filenames
as a product policy. It still canonicalizes root/candidate paths, rejects paths
outside the selected workspace, bounds directory/preview/Diff reads, and ignores
performance-heavy build/cache directories. These are functional correctness and
resource bounds, not a risk/approval system.

With Diff read-only, remove patch capture, accept/revert, fingerprints, source
identity conflict handling for mutation, and write/chmod/rename logic used only
by those actions. Preserve Git status/Diff reading and file preview/context.

## Test And Documentation Treatment

Tests whose sole subject is a deleted policy/repository/action are deleted with
the code. Cross-layer/Electron tests are rewritten around local RPC and retained
desktop workflows. No unrelated assertion is removed to obtain a pass.

Update current README/package/architecture/status text that claims a secure
workspace, Keychain, approvals, sensitive-file restrictions, risk scanning,
embedded Worker, or unsupported session/Diff mutation operations. Historical
task artifacts remain unless they are generated current contracts.

## Electron-Only Bootstrap And Settings

The renderer entry checks for the typed preload API before constructing any
provider/store. Without it, render one unsupported-environment surface and stop.
All production adapters are Electron adapters; their APIs are not nullable and
operations cannot silently return as web no-ops.

Move useful visual cases from the standalone Vite `webServer` suite to an
Electron Playwright configuration. They use temporary projects and deterministic
fake Pi fixtures under `tests/`, but exercise actual BrowserWindow, preload, IPC,
and Main composition. Delete product visual-state flags and static fixture UI.

After the data-owning siblings land, Settings navigation is exactly General,
Appearance, Language, Models, Terminal, MCP, and About. General uses the Main
runtime snapshot; Models uses the shared official renderer slice; Appearance,
Language, and Terminal use Main-owned current AppSettings; MCP uses its standard
config service and official adapter detection; About uses real Electron app
information. Errors and loading remain visible. Unimplemented sections are
absent, not disabled or populated with examples.

## Dependency And Build Cleanup

Remove the `src/agent-worker` electron-vite input after no production caller
uses it. Run pnpm removal for direct Pi SDK dependencies only after repository
imports are absent, and preserve the lockfile. Do not modify `node_modules` or
add a replacement Agent package.

## Rollback

Perform deletion in coherent, buildable groups and use commit revert for
rollback. There is no on-disk data migration or destructive cleanup to reverse.
