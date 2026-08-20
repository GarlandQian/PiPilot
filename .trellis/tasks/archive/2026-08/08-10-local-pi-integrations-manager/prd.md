# Local Pi integrations manager

## Goal

Manage the selected local Pi installation's packages/resources and provide Codex-inspired MCP structured editing while retaining exact JSONC editing.

## Parent And Dependency

- Parent: `08-10-mcp-session-runtime-ux`.
- No code dependency. This child reuses the existing exact executable resolver,
  workspace scope resolver, MCP service, and controlled runtime restart.
- Its package snapshot and public retry-settings contract must stabilize before
  `08-10-plan-retry-adapters` starts.

## Requirements

### Exact local-Pi package management

- Use the same canonical executable and exact supported version as the Agent
  RPC runtime. Do not add or bundle a Pi SDK dependency in PiPilot.
- For an importable Node/npm installation, load public `DefaultPackageManager`,
  `SettingsManager`, and `getAgentDir` from that executable's matching package
  root inside an isolated helper process.
- List global/project configured packages and resolved Extensions, Skills,
  Prompt Templates, and Themes with bounded source, version, scope, effective
  state, diagnostics, and compatibility facts.
- Install manual npm/git/URL/local sources, update, and remove through official
  package manager APIs with bounded progress and serialized mutations.
- Project operations resolve cwd only from an explicitly selected workspace.
- Successful package mutations require an explicit controlled Pi restart and a
  post-restart refresh before runtime compatibility is considered current.
- If no exact importable package root exists, show structured management as
  unavailable while leaving ordinary Pi RPC chat unaffected. Do not parse
  human CLI output or load a different Pi version.
- Resource effective state is read-only. Pi 0.84.1 has no public
  non-interactive single-resource filter mutation API; do not reproduce its
  private `pi config` rules.

### Integrations settings

- Replace standalone MCP navigation with one responsive Integrations section
  containing Overview, Packages, MCP, and Resources.
- Use a quiet searchable list/detail workspace, wide split view, narrow drill-
  in navigation, stable row dimensions, inline operations, and explicit
  empty/loading/error/restart/unavailable states.
- Compatibility labels distinguish generic RPC, rich adapter, partial, Pi TUI
  only, and not observed. Installation alone is never called compatible.
- Themes are labeled as Pi TUI resources, not PiPilot appearance themes.

### MCP structured and raw editing

- Default MCP UI is a scannable server list: name, transport badge, enabled
  switch, scope. Rows never expose env values, headers, or other secrets.
- Add and Edit share one complete form in a wide desktop dialog (title
  top-left, close top-right, footer Cancel + Add/Save). The same form
  component serves both flows; no separate minimal add dialog.
- Server name occupies a full row. There is no preset/common-MCP picker,
  recommendation, marketplace, or network search entry.
- STDIO fields: command, ordered args (dynamic rows with add/edit/delete
  preserving order), env (dynamic key/value rows), cwd, enabled state.
  HTTP fields: url, headers (dynamic key/value rows), enabled state. Only
  transports the contract truly supports: stdio + streamable HTTP.
- Optional description field: verified 2026-08-11 against installed
  pi-mcp-adapter — `ServerEntry` has no `description`, but its
  `validateConfig` is non-strict and preserves unknown fields, so the
  value persists in the JSONC document and is only ignored at runtime.
  Present it as a remark; never silently drop it.
- Inline validation: duplicate names, required fields, URL shape, and
  key/value row shape; closing a dirty form asks for confirmation.
- Retain exact global `~/.pi/agent/mcp.json` and selected-project
  `.mcp.json` paths, Global/Project scope, Save, and Save + Restart Pi.
- Explicit Form / JSON view toggle. Both edit the same draft content —
  no two diverging data models, and switching never saves, rebuilds, or
  reformats the document.
- JSON editing stays fully editable (not a preview), preserving JSONC
  comments, unknown fields, and the user's original formatting; configs
  the form cannot represent remain editable via JSON.
- JSON syntax errors surface exact line/column diagnostics; invalid JSON
  blocks saving but never overwrites or discards the user's draft.
- Keep fingerprint conflict detection and honest pi-mcp-adapter
  missing/available/error presentation. No Codex TOML migration; MCP is
  never claimed to be Pi core.
- Form layout adapts to dark/light themes and wide/narrow windows; the
  visual language (dialog chrome, dynamic-row primitives) comes from task
  `08-11-ui-redesign-command-center`.

## Acceptance Criteria

- [ ] The helper proves its imported Pi package name/version matches the
      selected executable before any package operation.
- [ ] Global/project package snapshots and resource lists come from official Pi
      APIs and reject stale scope/helper generations.
- [ ] Install, update, and remove serialize, stream bounded progress, persist
      through official APIs, mark restart pending, and refresh after controlled
      restart.
- [ ] A compiled/non-importable Pi installation reports management unavailable
      without breaking chat.
- [ ] Resources show effective state and an explicit Pi-config limitation with
      no nonfunctional toggle.
- [ ] Integrations list/detail works on wide and narrow windows with exact scope,
      stable layout, and inline operation states.
- [ ] MCP opens as a server list without secrets; one wide dialog form serves
      both Add and Edit with name full-row, dynamic args/env/headers rows,
      optional description, inline validation, and dirty-close confirmation.
- [ ] Form/JSON toggle edits one shared draft; JSON keeps comments, unknown
      fields, and user formatting; invalid JSON shows line/column diagnostics,
      blocks save, and preserves the draft.
- [ ] Structured/raw switching preserves comments and unknown fields, and stale
      fingerprints still produce the existing conflict behavior.
- [ ] No production dependency on `@earendil-works/pi-coding-agent`, CLI text
      parser, duplicate npm/git installer, or private resource-filter code is
      introduced.
- [ ] Focused helper/service/IPC/MCP tests, typecheck, build, and Settings
      Electron workflows pass.

## Out Of Scope

- Online package marketplace or recommendations.
- Updating Pi itself.
- Per-resource enable/disable until Pi exports a public non-interactive API.
- Reproducing TUI themes/components inside Electron.
- Package-specific runtime adapters beyond compatibility facts.
- Reformatting existing MCP documents or exposing secret values in list rows.
