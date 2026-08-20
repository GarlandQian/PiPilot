# Design — Manage custom models and default model

Decision X (user-confirmed 2026-08-12): form covers the common fields; the
Form|JSON single-draft pattern (mirroring `McpSettings.tsx`) carries
advanced fields. Pi keeps owning the data; every write goes through the
real `~/.pi/agent/models.json` / `~/.pi/agent/settings.json` files, and
runtime-visible changes require the existing controlled Pi restart.

## 1. Architecture slices

```
renderer  ModelsSettings.tsx ──► models-config adapter (window.pipilot preload)
                │                        │
                │ form model helpers     │ zod-validated invoke channels
                ▼                        ▼
shared    models-config.ts (zod)   models-config-schema.ts (typebox → JSONC)
                ▲                        │
main      models-config-service.ts ◄──────┘  (read/write, apiKey redaction,
                │                           fingerprint, atomic write)
                ▼
          pi-management-helper.ts + modelsJson / settingsJson commands
          (official ModelConfig.load / SettingsManager.setDefaultModelAndProvider)
```

No new npm dependencies. `jsonc-parser` 3.3.1 is already used by
`mcp-config-parser.ts` (393 LOC) and provides exact-offset JSONC
diagnostics; the JSONC write strategy replicates the MCP approach
(see §5).

### Why a separate `src/shared/models-config*.ts` pair instead of extending `mcp-config*.ts`

The MCP document shape (`{ mcpServers: {...} }`) and the models document
shape (`{ providers: { id: { baseUrl, apiKey, compat, models[] }}}`) share
only the "JSONC + fingerprint + redacted diagnostics" pattern. The zod
contracts (provider/model unions, form-capability predicates) diverge
sharply. A new module keeps each schema readable and lets MCP config
evolve independently.

## 2. Shared contracts (`src/shared/models-config.ts`)

```ts
type ModelsConfigTarget = { kind: 'global' }            // only scope Pi supports
interface ModelsConfigProvider {                        // read DTO
  id: string                                            // provider key in providers{}
  name?: string
  baseUrl?: string
  api?: string                                          // free-form string, e.g. openai-completions
  hasApiKey: true                                       // credential-blind: redacted presence flag
  headers: Record<string, string>
  compat?: unknown                                      // passthrough, never form-structured
  models: ModelsConfigModel[]
  source: 'custom'                                      // models.json entries only
}
interface ModelsConfigModel {
  id: string
  name?: string
  api?: string                // per-model override (advanced; form shows read-only)
  baseUrl?: string
  reasoning?: boolean
  thinkingLevelMap?: unknown  // passthrough
  input?: ('text' | 'image')[]
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number }
  contextWindow?: number
  maxTokens?: number
  headers?: Record<string, string>
  compat?: unknown
}
interface ModelsConfigDocument {
  providers: ModelsConfigProvider[]
  diagnostics: ModelsConfigDiagnostic[]   // same shape as MCP: code/message/offset/line/column/path
  valid: boolean                          // parseable JSONC with providers object
}
interface ModelsConfigSnapshot extends ModelsConfigDocument {
  target: ModelsConfigTarget
  path: string
  exists: boolean
  fingerprint: string          // sha256 hex of raw file
  defaultProvider?: string     // from settings.json
  defaultModel?: string        // from settings.json
}
```

Form-capability gate: `structuredProviderSupported(provider)` returns true
when the provider's values are all representable by the form (no
`oauth`, no non-string `headers` values, every model form-supported).
Unrepresentable providers render "JSON only" rows. The JSON view is always
available regardless.

### Form model shape (`ModelFormValue` / `ProviderFormValue`)

Flat records the `ui/form.tsx` primitives can bind directly:

```ts
interface ProviderFormValue {
  id: string; name: string; baseUrl: string; api: string
  apiKeyDraft: string           // '' means "keep existing key" on edit
  headers: KeyValueRow[]
}
interface ModelFormValue {
  id: string; name: string; reasoning: boolean
  inputText: boolean; inputImage: boolean
  contextWindow: string; maxTokens: string   // numeric strings, validated
  costInput: string; costOutput: string
  costCacheRead: string; costCacheWrite: string
}
```

Advanced fields (`compat`, `thinkingLevelMap`, per-model `api`/`baseUrl`,
`headers`, `cost.tiers[]`) are **preserved on write but never shown in the
form** (X decision). The form reads them into a hidden "passthrough blob"
and splices it back when rebuilding the JSONC.

### apiKey handling

- Read path: main service replaces every `apiKey` string with
  `hasApiKey: true` before sending to the renderer. The raw file stays on
  disk; the value never crosses IPC.
- Edit path: `apiKeyDraft` empty → the old `apiKey` line is kept verbatim
  (including its exact JSONC formatting); non-empty → the line is replaced
  with a freshly-escaped string value. A visible "Clear key" checkbox sets
  the field to absent (not `""`).

## 3. Shared JSONC write helpers (`src/shared/models-config-schema.ts`)

Mirror the four exported mutation helpers in `mcp-config-parser.ts:343-390`:

```ts
export function parseModelsConfigDocument(text: string): ModelsConfigDocument
export function upsertModelsProvider(text, providerId, form, passthrough): { text, diagnostics? }
export function removeModelsProvider(text, providerId): { text, diagnostics? }
export function setDefaultModel(text, providerId, modelId): { text }          // writes settings.json
```

Each helper round-trips through `jsonc-parser` (`parse` / `modify` /
`applyEdits`) with the same character-offset → line/column conversion the
MCP parser uses. Comments and unknown provider / model fields survive
because `modify` patches only the JSONC path being edited.

Vitest coverage (not required for pure styling) lives in
`tests/unit/models-config-schema.test.ts` and asserts: comment preservation,
unknown-field preservation, CRLF file safety, invalid JSON → diagnostics
with exact line/column, `hasApiKey` redaction round-trip.

## 4. Main process (`src/main/models-config/`)

```
src/main/models-config/
  models-config-service.ts    # read file, redact apiKeys, hash fingerprint,
                              # validate against shared schema, atomic write
                              # via writeFile + rename (same as MCP service)
  register-models-config-ipc.ts  # 5 channels, all validated-handler wrapped
```

Channels (added to `src/shared/ipc/contracts.ts` and the preload whitelist):

| Channel | Request | Response |
| --- | --- | --- |
| `pipilot:models:load` | `{ target: 'global' }` | `ModelsConfigSnapshot` |
| `pipilot:models:save` | `{ target, content, fingerprint }` | `{ applied, newFingerprint, diagnostics? }` |
| `pipilot:models:saveAndRestart` | same as save | `McpConfigRestartResult` (reuse existing union) |
| `pipilot:models:setDefault` | `{ providerId, modelId }` | `{ settingsUpdated: true, newDefaults }` |
| `pipilot:models:getDefaults` | `{ target }` | `{ defaultProvider?, defaultModel? }` |

Fingerprint semantics identical to `mcp-config-service.ts` (sha256 of raw
bytes; stale fingerprint → conflict result shape). The service writes the
file with the same atomicity trick (`writeFile` to sibling tmp, then
`rename`) so the user's editor state never observes a torn file.

## 5. Helper commands (modelsJson / settingsJson)

`src/main/local-pi-management/pi-management-helper.ts` gains two commands
(with the existing `HELPER_INPUT_LIMIT` guard):

```
modelsJson   → path = getModelsPath(); return ModelConfig.load(path)
               (credential-blind snapshot; helper never returns apiKeys)
settingsJson → mgr = SettingsManager over pi settings.json
               mgr.setDefaultModelAndProvider(provider, modelId)
```

`mcp-config-service.ts` already proved this helper round-trip works from
the main process; models commands slot into the same dispatch switch.

## 6. Settings surface — Models section rewrite (`src/components/settings/ModelsSettings.tsx`)

The read-only catalog becomes a workspace with three conceptual regions
(all client-side, no new components beyond a `models-form-model.ts`):

1. **Catalog list (top)** — grouped by provider (built-in + custom),
   each row: model name, id, context/max, capability badges, plus:
   - **Default badge** when the model is the current default (read from
     `defaultProvider`/`defaultModel` in the snapshot).
   - **"Set default"** ghost button (visible on hover or focus-within)
     that calls `setDefaultModel(provider, model)` and refreshes.
   - For custom providers: an overflow menu (⋯) with Edit / Delete.
2. **Custom providers panel (below)** — one row per custom provider with
   name/id, baseUrl, model count, "… models" drill-in; Add Provider
   button opens the FormDialog. Rows never display `apiKey` or header
   values (secret-free).
3. **Form|JSON workspace (main region)** — same segmented toggle as MCP.
   Form mode shows `ProviderCard`s (name, api chip, baseUrl mono, model
   list with inline per-model Edit/Delete buttons and one "Add model"
   sub-button); JSON mode shows the read-only, syntax-coloured document
   (same approach as MCP JSON view). Both edit one shared draft text.
   Save footer: "Save", "Save & Restart Pi", fingerprint-conflict banner.

The visual language is `ui/form.tsx` `FormDialog` (760px) reused as-is:
title top-left, ✕ top-right, body scrollable, footer Cancel + primary.

## 7. Form ↔ JSON single-draft flow

```
McpSettings.tsx pattern (line references verified 2026-08-12):

const [draftText, setDraftText]   = useState('')              // JSONC source of truth
const parsed = useMemo(() => parseModelsConfigDocument(draftText), [draftText])
const formSupported = structuredDocumentSupported(parsed)     // gates Form side

Form edit (e.g. rename provider "acme" → "acme-inc"):
  nextText = upsertModelsProvider(draftText, previousId, formValue, passthrough)
  setDraftText(nextText)          // comments, unknown fields, CRLF preserved

JSON edit:
  textarea onChange → setDraftText(rawText)
  diagnostics list below (exact line/column from jsonc-parser)
  Save disabled while !parsed.valid
```

`structuredDocumentSupported(document)` returns true iff every provider is
form-representable; if false the Form side shows an inline notice and the
JSON view stays enabled. Switching tabs never auto-saves, rebuilds, or
reformats the draft — the exact contract the MCP surface guarantees.

## 8. Keyboard, i18n, a11y

- All new strings under `settings.models.*` in both locales (flat dotted,
  zh/en parity); current 683-key catalogs gain ~25 keys.
- Every new button/menu item has an accessible name; the "Set default"
  button is focusable and its disabled+reason state is announced via
  `aria-describedby` pointing at the provider card.
- The FormDialog inherits the Command Center focus-ring token (2px
  outline + 1px offset) from `focusRing`'s shared utility in
  `globals.css`; no motion added, so reduced-motion is unchanged.

## 9. Risks and trade-offs

- **Secret redaction fidelity**. `hasApiKey: true` must be produced in the
  main process; the renderer must never see the raw value. Mitigation: the
  zod schema for the read DTO has no `apiKey` field at all (only
  `hasApiKey`), so a future leak fails typecheck.
- **Duplicate provider ids**. The JSONC upsert treats provider id as the
  object key; the form validates "same id" case-insensitively against the
  current document and shows an inline error before the user reaches Save.
- **Pi restart window**. After Save+Restart, the catalog refreshes via the
  existing `usePiRuntime` connection resume path; no extra polling is
  added.
- **Settings.json dual ownership**. Writing defaults from PiPilot races
  nothing, but the user's TUI could change the same file; the next
  snapshot read picks it up honestly, no caching layer is introduced.
- **What is deferred**: per-model `api`/`baseUrl` override and
  `thinkingLevelMap` structured editing stay JSON-only in this round. The
  form model has `passthrough` slots so a follow-up task can add toggles
  without touching the write path.
