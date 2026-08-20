# Technical Design

## Delivery Structure

This task is a coordination parent. Its implementation is split into four
independently verifiable child tasks because the runtime, Composer, Settings,
and adapter surfaces have different owners and rollback points:

| Child | Owns | Dependency |
| --- | --- | --- |
| `08-10-runtime-session-reliability` | clone-safe official RPC projection, catalog convergence, no-session inspector state | none |
| `08-10-composer-extension-ux` | shared `/` and `@` picker UX, typed-only `@`, generic extension presentation, conversation-column notifications | no code dependency; parent integration verification waits for runtime reliability |
| `08-10-local-pi-integrations-manager` | local-Pi package/resource bridge, Integrations Settings, Codex-inspired MCP list/form/raw modes | none; reuses the existing executable and MCP services |
| `08-10-plan-retry-adapters` | externally reachable Plan Mode and Retry adapters | requires the Composer generic activity host and Integrations package/settings snapshot |

The parent owns requirement consistency, shared-contract conflict resolution,
final Electron integration, spec updates, and the final quality gate. Child
order is explicit: reliability first; Composer and Integrations may then run in
parallel; Plan/Retry starts only after both contracts are stable.

## Architecture Boundaries

```text
selected official Pi executable
  |-- JSONL RPC process (conversation/session authority)
  |     -> Main validation/projection -> preload -> renderer projector
  |
  `-- isolated management helper (package/settings authority)
        -> matching Pi 0.84.1 public exports
        -> bounded typed DTO/progress -> Main IPC -> Integrations store

existing MCP JSONC service
  -> one parsed document + fingerprint
  -> structured server list/form OR raw editor
  -> explicit save / save+restart

official extension RPC surfaces
  -> generic commands/tools/status/widgets/dialogs/notifications
  -> capability/version gate
  -> Plan or Retry rich projection only
```

PiPilot remains Electron-only. Renderer code never imports the Pi SDK, reads Pi
package files directly, or starts package-manager commands. Pi owns sessions,
models, packages, filters, retry scheduling, extension execution, and extension
UI semantics.

## Runtime And Session Reliability

### Clone-Safe Command Projection

The local Pi process host continues validating the exact 0.84.1 response. The
Electron IPC boundary gains a separate renderer response schema. `get_tree` is
projected in Main from recursive official nodes to a flat bounded DTO:

```ts
type LocalPiTreeRow = {
  entry: LocalPiSessionEntry
  parentId: string | null
  depth: number
  order: number
  label?: string
  labelTimestamp?: string
}

type LocalPiTreeResult = {
  rows: LocalPiTreeRow[]
  leafId: string | null
}
```

Projection uses an explicit stack, preserves preorder, enforces existing node
and depth limits, validates the flat result, and performs a cloneability check
before the handler resolves. Other command results remain exact official JSON
DTOs. A projection/clone failure becomes a typed runtime error; it is never an
uncaught Electron handler exception or an arbitrary JSON string.

### Catalog Convergence

Each scope has one refresh coordinator with a monotonically increasing dirty
generation. A lifecycle invalidation during a scan marks that coordinator dirty
instead of starting competing work. The foreground refresh rescans until it
observes a clean generation within a bounded iteration/time budget. If normal
activation churn outlives the foreground budget, no stale snapshot is
published; one queued refresh continues and the renderer stays loading rather
than receiving a global operation-failure modal.

Token, cursor, path, identity, deletion, and activation failures remain typed
user-visible errors. Renderer request epochs suppress only superseded refresh
results/errors.

### Inspector Readiness

The existing conversation readiness projection is the single presentation
gate for Files, Changes, and Pi Session. Entering empty/loading/error unmounts
their session-owned controllers, clears cached rows, and increments request
epochs. Their centered empty/loading/error state occupies the full inspector
content region. Terminal remains workspace-scoped and available for a selected
project.

## Composer And Generic Extension UX

### Shared Candidate Surface

One compact composer-anchored shell renders both candidate types. A pure
selection controller receives rendered enabled option IDs and owns wrapping
ArrowUp/ArrowDown, Enter, Escape, active reconciliation, and scroll-following.
Headings and status rows are never options.

- `/` directly projects official Commands followed by installed Skills and
  filters both from the editor query. The nested `/skills` level, extra search
  input, and Back state are removed.
- `@` continues using Tiptap Suggestion identity/range validation but renders
  Files followed by Skills through the same shell.
- Typed `@` is the only mention trigger. The toolbar button, public synthetic
  trigger handle, toolbar-origin range restoration, and related state are
  deleted. The attachment button is unchanged.
- Both paths retain IME/keyCode-229 guards, valid ARIA listbox/option linkage,
  asynchronous source isolation, and scope/session/generation reset.

### Generic Extension Projection

Unknown extension tools use a neutral typed card with bounded structured
arguments/results, progress, duration, failure, and copy. They are not presented
as shell commands. Current string statuses/widgets share a compact collapsible
activity strip above the Composer. Completed tool activity stays with its
assistant turn.

Notifications move structurally into the positioned middle conversation
column, below the header and above transcript content. CSS layout, not computed
sidebar/inspector offsets, keeps the bounded stack at the conversation column's
upper-right.

`pi-subagents` is generic in this task. Its tool results remain readable, but
fleet/status/control methods are not exposed because the extension's v1 event
protocol is in-process and cannot be reached through Pi 0.84.1 JSONL RPC.

## Local Pi Integrations Manager

### Exact Installation Binding

Main first uses the existing executable resolver and exact version probe. A
`LocalPiPackageLocator` canonicalizes the executable and walks only its ancestor
chain to find a package manifest whose name and version match the resolved Pi
snapshot. It never searches arbitrary global module roots and never uses the
separate Pi-managed extension install as the Pi SDK.

For an importable Node/npm Pi installation, Main starts a bundled management
helper with Electron's Node mode (`ELECTRON_RUN_AS_NODE=1`). The helper imports
the matching external Pi package's public `DefaultPackageManager`,
`SettingsManager`, and `getAgentDir`; the module is not bundled into PiPilot.
The helper is isolated from the Agent RPC process and communicates through a
strict bounded JSONL protocol. Each operation is short-lived, and Main
serializes mutations.

If the selected executable is a compiled distribution without an importable
matching package root, structured management is `unavailable` while normal Pi
RPC chat remains usable. PiPilot does not parse human `pi list` output or ship a
potentially different SDK as fallback.

### Management DTO And Operations

The renderer receives only bounded typed management data:

```ts
type IntegrationScope =
  | { kind: 'global' }
  | { kind: 'project'; workspaceId: string }

type PiIntegrationSnapshot = {
  executable: { path: string; version: string }
  scope: IntegrationScope
  packages: PiPackageSummary[]
  resources: PiResourceSummary[]
  updates: PiPackageUpdate[]
  retry: { enabled: boolean; maxRetries: number; baseDelayMs: number }
  restartRequired: boolean
  diagnostics: PiIntegrationDiagnostic[]
}
```

The helper delegates listing, resolution, install, update, and removal to public
Pi APIs. Main forwards bounded official progress events and exposes one mutation
at a time. Project scope always resolves from a user-selected workspace ID. A
successful mutation marks restart required; controlled restart refreshes
commands, Skills, extension observations, and the management snapshot before
clearing it.

Resolved resource state is read-only. Although public `SettingsManager` exposes
the raw `PackageSource[]`, Pi 0.84.1 does not export the TUI's single-resource
filter mutation semantics. PiPilot does not recreate those private rules or
write ad hoc filters; Integrations directs advanced resource filtering to Pi's
own `pi config` until a public non-interactive API exists.

Compatibility is descriptive, not inferred from installation alone:
`generic-rpc`, `rich-adapter`, `partial`, `pi-tui-only`, or `not-observed`.
Observed runtime surfaces are generation/session scoped and do not mutate
package configuration.

### Settings And MCP

Settings replaces the standalone MCP destination with a wider Integrations
list/detail workspace. Overview, Packages, MCP, and Resources are internal
views. Wide layouts keep list and detail visible; narrow layouts drill into the
detail view.

MCP retains the existing exact paths, parser, JSONC source document,
fingerprint conflict handling, and controlled restart. Structured list/form and
Raw JSON are two projections of the same draft. Switching modes never
re-serializes untouched text, drops comments, or discards unknown fields.

## Plan And Retry Adapters

Adapters activate only after exact package/version plus structured capability
validation. Missing, unsupported, malformed, or stale data falls back to the
generic extension UI.

### Plan Mode

Plan Mode uses only externally visible public surfaces:

- `get_commands` confirms the `/plan` command and source metadata;
- versioned `plan_mode_complete` tool details provide bounded Markdown;
- `proposed-plan` custom messages and exact plan status values restore state;
- validated direct `/plan` routes are invoked through the official prompt
  command; interactive choices continue through the existing extension UI
  dialog protocol.

The adapter never reads package-private session entries or extension files at
runtime. Unsupported versions keep the ordinary tool/custom-message/status
presentation.

### Retry

Pi's official retry engine remains authoritative. The management helper reads
and writes `retry.enabled` using the matching `SettingsManager`, calls `flush()`,
and returns effective `maxRetries` and `baseDelayMs`. After persistence, Main
synchronizes a ready Agent process with official `set_auto_retry`. Partial
persistence/runtime failure is explicit.

Official `auto_retry_start`/`auto_retry_end` events drive a compact block above
the Composer. A display-only deadline produces the countdown; it never starts
an attempt. `abort_retry` is enabled only during Pi's cancellable delay. The
supported `pi-retry` version may enrich the same projection from exact
`retry=receiving|retrying` status values. Summarization retry remains separate.

All adapter state is keyed by scope, session ID, and runtime generation and is
cleared on replacement.

## Failure And Compatibility Matrix

| Condition | Required behavior |
| --- | --- |
| Deep valid tree | flat clone-safe result, no stack overflow or IPC exception |
| Catalog invalidated during scan | converge or remain loading with queued refresh; no false modal |
| Genuine stale selection/path | typed visible failure |
| No selected/hydrated session | centered empty/loading inspector; no stale rows |
| Package helper cannot locate exact module | Integrations unavailable; chat unaffected |
| Package mutation fails | bounded inline error; no automatic restart |
| Package mutation succeeds | pending restart until controlled refresh succeeds |
| User inspects a disabled resource | show effective state and Pi-config limitation; no fake toggle |
| MCP structured/raw conflict | existing fingerprint conflict; preserve user draft |
| Unknown/TUI-only extension | generic/degraded label; never claim rich support |
| Subagents installed | generic structured tool UI only |
| Plan/Retry schema or version mismatch | generic fallback and compatibility diagnostic |
| Retry persisted but runtime sync fails | persisted value shown with explicit partial failure |

## Rollback And Migration

There is no legacy-data migration. MCP continues using the same files and
fingerprints; Pi settings/packages are changed only after explicit user actions
through official Pi APIs. Renderer features can be reverted independently.
The management helper and adapters are additive and may be disabled without
affecting the official Agent RPC host. A code rollback cannot undo packages the
user explicitly installed or removed, so operation results always identify the
completed official action before offering restart.
