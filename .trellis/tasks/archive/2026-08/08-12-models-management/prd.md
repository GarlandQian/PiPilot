# Manage custom models and default model

## Goal

Add model management to PiPilot's Models settings: create, edit, and
remove custom providers/models in Pi's real `~/.pi/agent/models.json`,
and set the default model (Pi `settings.json` `defaultProvider` /
`defaultModel`) from the GUI. Pi owns the data; PiPilot edits Pi's own
files through official APIs with restart-aware application, mirroring the
MCP surface's fidelity rules.

## Confirmed Facts (verified 2026-08-12 against installed Pi 0.84.x)

- `~/.pi/agent/models.json` holds custom providers. Provider fields:
  `name`, `baseUrl`, `apiKey`, `api` (free-form string, e.g.
  `openai-completions`), `oauth`, `headers`, `compat` (large nested
  object: supportsStore, thinkingFormat enum, chatTemplateKwargs,
  openRouterRouting, …), `models[]`.
- Model fields: `id`, `name`, `api`, `baseUrl` (per-model overrides),
  `reasoning`, `thinkingLevelMap`, `input` (`text`|`image`[]), `cost`
  (`input/output/cacheRead/cacheWrite` + optional `tiers[]`),
  `contextWindow`, `maxTokens`, `headers`, `compat`.
- Pi parses models.json tolerantly:
  `JSON.parse(stripJsonComments(content))`
  (`dist/core/model-config.js:214`) — comments are legal and must be
  preserved on write.
- Official public APIs in the installed package:
  `ModelConfig.load(path)` (credential-blind snapshot),
  `getModelsPath()` / `getSettingsPath()` (`dist/config.d.ts`),
  `SettingsManager.setDefaultModelAndProvider(provider, modelId)` +
  `setDefaultProvider` / `setDefaultModel`
  (`dist/core/settings-manager.d.ts:183-185`).
- Runtime catalog comes from RPC `get_available_models` (merged built-in
  + models.json); `set_model` selects the *session* model only — it does
  not persist a default.
- Current `ModelsSettings.tsx` is a read-only grouped catalog +
  per-session select. No management exists.
- `models.json` is global-only; Pi has no project-level models file.
- models.json contains plaintext `apiKey` secrets — list rows and forms
  must never render an existing key; a blank key field on edit means
  "keep".
- models.json changes require a Pi restart to reach the runtime catalog
  (same controlled-restart flow as MCP config; RPC has no reload
  command).
- Reusable PiPilot assets: the main-process official-API helper
  (`pi-management-helper.ts`), the MCP Form|JSON single-draft pattern
  (`McpSettings.tsx` + `mcp-config-parser.ts`, `jsonc-parser` 3.3.1
  already a dependency), and `ui/form.tsx` primitives (FormDialog /
  FormRow / DynamicRows / KeyValueRows).

## Decisions (2026-08-12, user-confirmed)

- **Decision X — form depth**: structured forms cover the common fields
  only; advanced fields (`compat`, `thinkingLevelMap`, `cost.tiers[]`,
  per-model `api`/`baseUrl` overrides, openRouterRouting) stay JSON-only
  via the Form|JSON single-draft pattern and are preserved verbatim on
  form writes.

## Requirements

### R1 Provider management

- Add/edit/remove custom providers with fields: id (object key), name,
  baseUrl, api (suggested values + free text), apiKey, headers
  (KeyValueRows).
- apiKey never rendered; blank draft keeps the existing key verbatim, a
  non-empty draft replaces it, an explicit "clear key" control removes
  the field.
- Duplicate provider id validation (case-insensitive) before save.

### R2 Model management

- Add/edit/remove models under a custom provider with fields: id, name,
  reasoning switch, input (text/image), contextWindow, maxTokens,
  cost (input/output/cacheRead/cacheWrite).
- Duplicate model id validation within the provider; numeric fields
  validated (contextWindow ≥ 1, maxTokens ≥ 1, costs ≥ 0).
- Advanced fields on existing models are preserved through every form
  write and editable in the JSON view.

### R3 Default model

- Every catalog model row (built-in and custom) offers a "Set default"
  action calling `SettingsManager.setDefaultModelAndProvider` via the
  management helper; the current default is visibly marked and updates
  after the write.

### R4 Form|JSON single draft

- One shared JSONC draft text backs both the Form workspace and the JSON
  editor; switching views never saves, rebuilds, or reformats.
- JSON editing stays fully editable with exact line/column diagnostics;
  invalid JSON blocks save but never discards the draft.
- Form edits apply via JSONC path-targeted modifications that preserve
  comments and unknown fields; form-unrepresentable providers are marked
  "JSON only" and remain JSON-editable.
- Fingerprint conflict detection identical to MCP; Save and
  Save & Restart Pi both offered; restart pending state presented
  honestly.

### R5 Contracts, IPC, and secrets

- New zod contracts in `src/shared/models-config.ts`; the renderer DTO
  has `hasApiKey` only (no `apiKey` field — a leak fails typecheck).
- Five new preload-whitelisted channels
  (`pipilot:models:load|save|saveAndRestart|setDefault|getDefaults`);
  no existing MCP/runtime channels change.
- Main-process service: sha256 fingerprint, atomic write (tmp + rename),
  redaction before IPC; management helper gains `modelsJson` /
  `settingsJson` commands and never returns apiKey values.

### R6 i18n and accessibility

- All new strings under `settings.models.*` in zh-CN and en-US with key
  parity; every new control labelled and keyboard-reachable.

## Acceptance Criteria

- [ ] Add a provider + model through the form; the file on disk gains
      exactly the new entries with comments and other providers
      untouched; after restart the runtime catalog lists the new model.
- [ ] Edit a provider whose JSON contains comments, `compat`, and a
      model with `thinkingLevelMap`/`cost.tiers`: all survive the save
      byte-for-byte except the edited paths.
- [ ] apiKey is never displayed anywhere (list, form, JSON view shows
      raw file text only in the JSON editor the user already owns);
      blank-keeps and clear-key semantics behave as specified.
- [ ] Set default on any model updates `settings.json`
      `defaultProvider`/`defaultModel` and the UI badge moves.
- [ ] Invalid JSON in the JSON view shows exact line/column diagnostics,
      blocks save, and preserves the draft; stale fingerprint produces
      the conflict banner.
- [ ] Focused Vitest (`models-config-schema`) covers comment/unknown
      preservation, CRLF, diagnostics, and redaction round-trips;
      `pnpm typecheck` and `pnpm build` pass (final verification by
      user).

## Out Of Scope

- Built-in provider/model catalog editing (read-only).
- OAuth flows (`oauth: "radius"`), `models-store.json`, auth.json.
- Structured editing of `compat`, `thinkingLevelMap`, `cost.tiers[]`,
  per-model `api`/`baseUrl` overrides (JSON view only this round; form
  model keeps passthrough slots for a follow-up).
- Session-level model switching (already shipped).
- Any change to MCP config channels, runtime RPC, or preload surface
  beyond the five new models channels.
- Committing changes (Phase 3.4 after user verification).
