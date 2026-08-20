# Technical Design

## Exact Installation Locator

`LocalPiExecutableService` remains the source of canonical executable/version.
The package locator starts at `realpath(executablePath)` and examines only
ancestor package manifests. It accepts exactly
`@earendil-works/pi-coding-agent` with the probed version and exported
`dist/index.js`. A wrapper or compiled binary that cannot prove this relation
returns typed `managementUnavailable`.

The separate `~/.pi/agent/npm` package area is never used as the Pi SDK root; it
contains Pi-managed extensions and can hold an unrelated historical Pi package.

## Isolated Management Helper

Main starts a bundled helper through the packaged Electron executable with
`ELECTRON_RUN_AS_NODE=1`. Invocation includes canonical module entry, exact
version, resolved cwd, operation, and bounded data. The helper imports only
public exports from the matching external Pi package and emits strict JSONL:

```ts
type PiManagementEvent =
  | { type: 'progress'; operationId: string; progress: PiProgressDto }
  | { type: 'result'; operationId: string; result: PiManagementResult }
  | { type: 'error'; operationId: string; error: PiManagementErrorDto }
```

Records, stderr, operation time, and final DTO sizes are bounded. Main owns
process deadlines and termination. Read snapshots may coalesce per executable/
scope. Mutations are single-flight globally so settings locks, package installs,
and restart state cannot race.

The helper constructs `SettingsManager.create(cwd, getAgentDir(), {
projectTrusted: true })` only for a Main-resolved selected workspace, then
constructs `DefaultPackageManager`. It calls public list/resolve/install/update/
remove/check-update methods and `flush()` where applicable.

## Renderer Contracts

Shared contracts contain no class instances or unknown recursive values:

```ts
type IntegrationScope =
  | { kind: 'global' }
  | { kind: 'project'; workspaceId: string }

type PiPackageSummary = {
  id: string
  source: string
  displayName: string
  scope: 'global' | 'project'
  installedVersion?: string
  pinned: boolean
  resourceCounts: Record<PiResourceKind, number>
  compatibility: PiCompatibilityLabel
}

type PiResourceSummary = {
  id: string
  kind: 'extension' | 'skill' | 'prompt' | 'theme'
  label: string
  source: string
  scope: 'global' | 'project'
  effectiveState: 'enabled' | 'disabled' | 'inherited'
  invocation?: string
  diagnostic?: string
}
```

Opaque operation IDs correlate progress. Scope/executable generations reject
late results. Runtime observations (commands, statuses, widgets, extension
errors) are joined in Main/renderer by bounded source identity only for display;
they never change settings.

## Restart Lifecycle

A successful package mutation sets a persisted-in-app pending restart marker
keyed by the selected executable and affected scope. The marker does not imply
runtime compatibility. Controlled restart uses the existing local-Pi restart
path; after ready, the store refreshes commands/Skills, management snapshot, and
observed extension surfaces. Only that complete success clears the marker.

## Settings Layout

`SettingsLayout` allows Integrations a wider content region while preserving
existing widths for General/Models/Terminal/Appearance/Language/About.
Integrations owns internal Overview/Packages/MCP/Resources navigation and one
selected-item route. Wide and narrow composition share row/detail components.

Package/resource operations are inline; normal success is not modal. Resource
rows are read-only and explain the official Pi-config boundary. Package details
show compatibility facts separately from configuration state.

## MCP Draft Ownership

The existing MCP adapter remains the only load/save/restart owner. A draft model
indexes parsed servers by stable document identity and maps the selected server
to transport-specific form fields. Raw text and structured edits update one
draft; untouched comments/unknown properties are retained through the existing
JSONC edit mechanism. Mode changes do not save.

If a structured mutation cannot preserve an unsupported server shape, that row
opens Raw JSON rather than normalizing or dropping data. Secret/header/env
values are editable only in detail and never rendered in list summaries.

## Rollback

The helper/contracts/store/Integrations UI are additive and can be removed
without changing Pi session files. MCP rollback reuses the same service and
documents, so no data migration is required. User-confirmed Pi package
operations are external state and are not automatically reversed by app code.
