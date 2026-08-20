# Implement — Manage custom models and default model

Direct implementation by the main agent (inline; no sub-agent dispatch).
Worktree is dirty with unrelated user changes — never `git add -A`, never
touch files outside this plan. No commits until the user's verification
round (same rule as the UI redesign task).

Spec references: `.trellis/spec/frontend/component-guidelines.md`,
`type-safety.md`, `state-management.md`; MCP reference implementation:
`src/shared/mcp-config-parser.ts` (393 LOC, `jsonc-parser` 3.3.1),
`src/main/mcp/mcp-config-service.ts` (315 LOC),
`src/components/settings/McpSettings.tsx` (~440 LOC, Form|JSON pattern).

## Phase 1 — Shared contracts and JSONC helpers

- [x] 1.1 `src/shared/models-config.ts`: zod schemas + TS types per
      design §2 (target/document/snapshot/provider/model/diagnostic,
      `ModelsConfigSaveResult`, `structuredProviderSupported`,
      `structuredModelSupported`, `structuredDocumentSupported`).
      Read DTO has `hasApiKey` only — no `apiKey` field anywhere in the
      renderer-facing schema.
- [x] 1.2 `src/shared/models-config-schema.ts`:
      `parseModelsConfigDocument`, `upsertModelsProvider`,
      `removeModelsProvider` using `jsonc-parser` parse/modify/applyEdits
      with MCP-identical offset→line/column diagnostics; unknown-field and
      comment preservation via modify-at-path only.
- [x] 1.3 `src/components/settings/models-form-model.ts`:
      `ProviderFormValue`/`ModelFormValue`,
      `formValueFromProvider`, `definitionFromFormValues` (with
      passthrough blob splice), validation helpers (duplicate provider id
      case-insensitive, duplicate model id within provider, numeric
      ranges: contextWindow ≥ 1, maxTokens ≥ 1, costs ≥ 0).
- [x] 1.4 `tests/unit/models-config-schema.test.ts`: comment
      preservation, unknown-field preservation (compat/thinkingLevelMap/
      cost.tiers survive form round-trip), CRLF safety, invalid JSON →
      exact line/column diagnostic, duplicate-key diagnostics, apiKey
      redaction round-trip (blank-keeps, replace, clear).
- Validate: `pnpm vitest run tests/unit/models-config-schema.test.ts` +
  `pnpm typecheck`.

## Phase 2 — Main process service + helper + IPC

- [x] 2.1 Extend `pi-management-helper.ts` with `modelsJson` (returns
      `ModelConfig.load(getModelsPath())` + raw settings defaults) and
      `settingsJson` (`setDefaultModelAndProvider`) commands; honor
      HELPER_INPUT_LIMIT; helper never returns apiKey values.
- [x] 2.2 `src/main/models-config/models-config-service.ts`: read raw
      file, sha256 fingerprint, redact apiKeys to `hasApiKey`, validate
      via shared schema, atomic write (tmp + rename), fingerprint
      conflict result, exists=false for missing file.
- [x] 2.3 `src/shared/ipc/contracts.ts` + `src/preload/index.ts`:
      channels `pipilot:models:load|save|saveAndRestart|setDefault|
      getDefaults` with zod-validated handlers; `saveAndRestart` reuses
      the existing controlled-restart machinery from the MCP path.
- [x] 2.4 `src/renderer/adapters/models-config-adapter.ts`: thin typed
      wrapper (mirrors `mcp-config-adapter.ts`).
- Validate: `pnpm typecheck`; focused service Vitest if a main-side test
  harness exists for mcp-config-service (mirror it), otherwise defer to
  user Playwright round.

## Phase 3 — Models settings surface

- [x] 3.1 Rewrite `src/components/settings/ModelsSettings.tsx` per
      design §6: add default badge + "Set default" actions through the
      provider management workspace, custom provider/model cards, Form|JSON
      segmented editing with a single draft text, save footer (Save / Save &
      Restart Pi / fingerprint-conflict banner), and restart-pending
      presentation consistent with MCP. The redundant runtime catalog is
      removed in Phase 4.5 per the final user-approved IA.
- [x] 3.2 `ProviderFormDialog` + `ModelFormDialog` on
      `ui/form.tsx` primitives (FormDialog 760px, FormRow, KeyValueRows);
      provider fields per design §2 (apiKey masked, blank-keeps, clear
      checkbox); model fields per design §2 (input as two switches,
      numeric fields as text inputs with validation); dirty-close
      confirmation via AlertDialog.
- [x] 3.3 i18n: ~25 keys under `settings.models.*` in zh-CN + en-US
      (parity enforced by the key-diff script used in the UI task).
- Validate: `pnpm typecheck`; locale parity script.

## Phase 4 — Final wiring and checks

- [x] 4.1 Sanity-flow by reading the composed component: load → form
      edit → draft text changes → JSON tab shows same content → save →
      fingerprint refresh; JSON invalid → save blocked, draft kept;
      set-default → snapshot defaults update → badge moves.
- [x] 4.2 `pnpm typecheck` + `pnpm vitest run tests/unit/models-config-schema.test.ts`
      + `pnpm build`.
- [ ] Report surfaces changed, files touched, residual risks; hand the
      user the verification list (typecheck, focused Vitest, build,
      manual: add provider/model, edit, set default, restart, JSON mode
      round-trip, secret non-display).
- [x] 4.3 User-approved renderer information architecture: provider/vendor
      cards use compact headers with expand/collapse state and provider
      action menus (edit, duplicate, delete); expanded model lists provide
      bulk selection/removal, fetch (runtime refresh), test (official
      `set_model`), set-default, and per-model edit/delete actions.
      Form|JSON remains the single advanced-editing draft and provider
      duplication omits stored keys.
- [x] 4.4 User-approved form behavior: advanced passthrough fields no longer
      gate or auto-switch the structured form. Form remains the default for
      valid drafts, while localized non-blocking notices and badges explain
      that JSON-only fields are preserved and directly editable in JSON.
- [x] 4.5 User-approved renderer cleanup: removed the redundant runtime
      "Available models" catalog from Models settings; provider/model
      management cards remain the single management surface while chat/header
      model selection and Pi runtime state stay unchanged.
- [ ] After user verification: spec update (backend + frontend specs
      gain the models-config pattern), then commit only this task's
      files.

## Rollback points

- After each phase, `git status` must show only planned files; revert a
  phase with `git checkout -- <phase files>` (no commits exist yet).
- Phase 1 is pure-additive (new files); Phase 2 adds channels without
  touching MCP channels; Phase 3 replaces only `ModelsSettings.tsx` —
  the previous read-only catalog is recoverable via git.

---

## Phase 2 completion notes (implement agent, 2026-08-12)

Delivered Phase 2 (main-process service + helper commands + IPC + preload + renderer adapter).

Files created:
- `src/main/models-config/models-config-service.ts` — `ModelsConfigService` (fingerprint `sha256`, atomic sibling-tmp+rename write, apiKey→hasApiKey redaction via the shared parser, helper-backed defaults with read-only JSONC fallback) + `ModelsConfigController` (MCP-identical `saved`/`restarted`/`pending`/`unavailable`/`failed` apply union).
- `src/main/ipc/register-models-config-ipc.ts` — 5 validated handlers, ModelsConfigError→MainProcessError mapping.
- `src/renderer/adapters/models-config-adapter.ts` — `createModelsConfigAdapter()` mirroring the MCP adapter.
- `tests/unit/models-config-service.test.ts` — 8 focused cases (global path pinning, helper-unavailable defaults fallback, apiKey redaction, conflict without overwrite, invalid JSON no-write, helper-backed setDefault, honest failure, generation-scoped pending restart).

Files modified:
- `src/shared/pi-integrations.ts` — `piManagementModelsPayloadSchema` + `models` payload member; helper commands `models-defaults` and `set-default-model`.
- `src/main/local-pi-management/pi-management-helper.ts` — `ExternalSettingsManager` default-model getters/setter; `modelsResult()` and the two new action handlers (SettingsManager + `throwSettingsErrors` around `flush()`).
- `src/main/local-pi-management/local-pi-management-host.ts` — `mutation()` now includes `set-default-model`.
- `src/main/local-pi-management/local-pi-integration-service.ts` — widened `runHelper` union; `modelsDefaults()` and `setDefaultModel()` + `requireModelsPayload` guard.
- `src/shared/ipc/contracts.ts` — 5 channel names + 5 `defineIpcContract` contracts.
- `src/preload/index.ts` — `window.pipilot.modelsConfig` exposure (getDefaults/load/save/saveAndRestart/setDefault).
- `src/shared/pipilot-api.ts` — `PiPilotApi.modelsConfig` type surface.
- `src/main/index.ts` — imports, `modelsConfigController` holder, service/controller construction + `registerModelsConfigIpc`, disposal.
- `tests/unit/models-config-schema.test.ts` — 1-char-scope fix: `replaceAll('\n','\r\n')` → `replace(/\n/g,'\r\n')` (tsconfig lib is ES2020; `replaceAll` needs ES2021). Pre-existing Phase 1 blocker for the typecheck gate; semantically identical.

Deviations from the delegated prompt:
1. Helper actions named `models-defaults`/`set-default-model` (not `modelsJson`/`settingsJson`) to match the existing action-verb convention.
2. Helper returns the payload via the existing `result` event's `models` field (minimal snapshot envelope) instead of a new transport channel — the host's typed `run()` resolves one `PiManagementSnapshotPayload`, so new actions reuse that single return path.
3. `PiIntegrationOperationKind` unchanged — the new reads/mutation are not user-facing integration operations and must not emit operation progress UI.
4. `getModelsPath`/`getSettingsPath`/`ModelConfig` are NOT exported from the Pi package's public `index.js` — they exist only in `dist/config.d.ts`, which is not a runtime import surface. The helper derives paths from the officially exported `getAgentDir()` + known Pi Agent layout (`models.json`/`settings.json`); defaults are read/written through the official `SettingsManager` (`getDefaultProvider/Model`, `setDefaultModelAndProvider`).

Validation (all real, this worktree):
- `pnpm typecheck` → clean.
- `pnpm vitest run tests/unit/models-config-schema.test.ts tests/unit/models-config-service.test.ts tests/unit/pi-integrations-service.test.ts` → 36 passed.
- `pnpm vitest run` (full unit) → 347 passed / 49 files.
- `pnpm build` → clean (incl. `out/main/pi-management-helper.js`).
- `rg -n "pipilot:models" src/...` → 5 channel names + 1 fingerprint salt, mirrored to the 2 MCP declaration sites.
