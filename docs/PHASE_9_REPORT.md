# Phase 9 Report - Models, Providers, and Keys

Date: 2026-08-08

> **Historical snapshot (2026-08-08):** This report preserves the evidence and
> assumptions of Phase 9. It is not current product or release authority. See
> [the documentation index](README.md), [Architecture](ARCHITECTURE.md),
> [Packaging](PACKAGING.md), and [Test Matrix](TEST_MATRIX.md).

## 1. Phase name

Phase 9 - Real Pi models/providers, per-session selection, safe credentials, and
bounded provider output.

## 2. Completed work

- Inspected the installed `@earendil-works/pi-coding-agent` and
  `@earendil-works/pi-ai` 0.84.0 declarations, implementation, built-in catalog,
  `models.json` schema, Provider composition, credential operations, session
  model APIs, simple request conversion, context reserve, and OpenAI-compatible
  payload generation before using their version-specific APIs.
- Replaced Electron model fixtures with the actual Pi `ModelRuntime` catalog,
  including built-ins and custom Providers/models from `models.json`.
- Exposed only validated provider/name/model/reasoning/image/context/output/
  configured metadata. Models with non-integer, non-positive, over-10-million,
  or internally inconsistent context/output metadata are omitted and counted.
- Grouped the settings catalog by Pi Provider and connected the existing header,
  context meter, Composer switcher, and Models settings destination to one real
  Electron model store. Browser preview continues to use the frozen fixture.
- Connected per-session model selection and thinking-level selection. Renderer
  state updates only after a successful worker result. Unconfigured models fail
  before mutation; a mid-switch failure restores the prior model and thinking
  level, including the edge case where the failed operation cleared the model.
- Wrapped the Pi `ModelRuntime.stream` and `streamSimple` entry points so every
  session, extension, direct model, and connection-test request receives the
  same output-limit policy.
- Kept the actual Pi compatibility configuration intact. The output request is
  capped to the minimum of requested tokens, declared `maxTokens`, the 32,768
  application limit, and Pi's remaining-context limit with its 4,096-token
  reserve. Pi still selects `max_tokens` or `max_completion_tokens` from the
  resolved Provider/model compatibility flags.
- Added a Main-owned atomic credential repository at `userData/credentials.json`
  using Electron asynchronous `safeStorage`, owner-only file mode, corrupt-file
  backup, serialized mutations, persistence rollback, and platform-requested
  key rotation.
- Added provider API-key create/update/delete/test. Renderer read/results contain
  only provider ID, configured state, masked suffix, storage backend, and
  synchronization state. Delete requires an explicit confirmation literal.
- Added a private bounded Main-to-Utility credential path for startup and hot
  synchronization. Runtime keys remain only in worker memory required by Pi and
  are cleared on disposal; no full key enters a session file or diagnostic.
- Added a bounded live connection test: first valid Provider model, 16 output
  tokens, zero retries, ten-second abort/timeout, and a generic error surface.
- Added Linux backend reporting. `basic_text` is a degraded localized warning;
  unavailable encryption rejects writes instead of storing plaintext.
- Added every new visible string to both `zh-CN` and `en-US` catalogs without
  changing frozen theme tokens, typography, spacing, layout, Markdown, or card
  structure.

## 3. Modified files

- `src/shared/credentials.ts`
- `src/shared/agent-protocol.ts`
- `src/shared/ipc/contracts.ts`
- `src/shared/pipilot-api.ts`
- `src/main/security/credential-cryptography.ts`
- `src/main/repositories/credential-repository.ts`
- `src/main/ipc/register-credential-ipc.ts`
- `src/main/agent/agent-runtime-supervisor.ts`
- `src/main/index.ts`
- `src/preload/index.ts`
- `src/agent-worker/model-safety.ts`
- `src/agent-worker/index.ts`
- `src/store/models.tsx`
- `src/main.tsx`
- `src/App.tsx`
- `src/components/chat/Composer.tsx`
- `src/components/settings/ModelsSettings.tsx`
- `src/components/settings/SettingsLayout.tsx`
- `src/i18n/locales/en-US.json`
- `src/i18n/locales/zh-CN.json`
- `tests/unit/credential-repository.test.ts`
- `tests/unit/model-safety.test.ts`
- `tests/unit/agent-protocol.test.ts`
- `tests/unit/ipc-contracts.test.ts`
- `tests/electron/pipilot.electron.spec.ts`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/PHASE_9_REPORT.md`

## 4. Purpose of each modified file

| File/group | Purpose |
| --- | --- |
| shared credentials/protocol/contracts/API | Strict secret-bearing private types, non-secret public metadata, model limits, named IPC, and narrow facade |
| Main cryptography/repository/credential IPC | Async safeStorage, atomic encrypted persistence, backend state, explicit CRUD/test, trusted sender, and generic failures |
| Main supervisor/application | Decrypt only for worker startup, hot synchronization, repository initialization, and code-only diagnostics |
| Agent worker/model safety | Real Pi catalog/auth projection, model/thinking operations, rollback, connection test, and request-wide output cap |
| model store/provider | One Electron source of truth with response-after-success updates and deterministic browser fixture |
| App/Composer/settings UI | Existing header/context/switcher/Models regions connected to real grouped metadata and credential controls |
| locale catalogs | Complete bilingual model, metadata, thinking, safeStorage, CRUD, test, and warning copy |
| unit/Electron tests | Persistence, rotation, degradation, schema boundaries, malformed metadata, real Pi payload, rollback, custom Provider, Keychain, and restart evidence |
| docs | Implemented architecture, completion state, exact verification, limitations, and Phase 10 handoff |

## 5. Dependencies added and reason

None.

Electron `safeStorage`, the installed Pi 0.84.0 packages, Zod, React, existing
Radix/shadcn primitives, React Icons, Vitest, and repository Playwright already
cover the required behavior. Playwright MCP can assist interactive inspection,
but it cannot replace the checked-in Playwright dependency, repeatable test
configuration, Electron harness, CI execution, or application runtime code. No
browser binary or Codex/agent Skill was installed.

Authoritative sources inspected:

- <https://www.electronjs.org/docs/latest/api/safe-storage>
- <https://github.com/earendil-works/pi/tree/master/packages/coding-agent>
- installed Pi 0.84.0 `docs/models.md`, declarations, and distribution source

## 6. New IPC

| Channel | Preload facade | Result |
| --- | --- | --- |
| `pipilot:credential:list` | `credentials.list()` | Revision, configured providers, masked suffixes, and backend state |
| `pipilot:credential:set` | `credentials.set(providerId, apiKey)` | Non-secret snapshot and runtime synchronization flag |
| `pipilot:credential:delete` | `credentials.delete(providerId, true)` | Confirmed non-secret snapshot and synchronization flag |
| `pipilot:credential:test` | `credentials.test(providerId)` | Provider ID and literal connected state |

The existing named `model.list`, `model.select`, and `thinking.select` routes now
return/use the expanded real Pi metadata and per-session behavior. The private
Agent protocol additionally has bounded `credential.set/delete/test` operations
and startup credentials; these are not exposed as a generic Renderer transport.

No raw `ipcRenderer`, generic invoke/send, safeStorage primitive, encrypted blob,
full stored key, Pi runtime object, Provider error body, or session path is
exposed through preload.

## 7. New shared types

- `AgentModel` expanded with Provider name, reasoning/image support,
  `contextWindow`, `maxTokens`, and configured state
- `AgentContextUsage`
- `CredentialStorageBackend`
- `ProviderCredentialMetadata`
- `CredentialSecurity`
- `CredentialSnapshot`
- `CredentialMutationResult`
- `CredentialTestResult`
- internal-only `RuntimeCredential`
- internal persisted credential document/entry schemas

## 8. New runtime schemas

- bounded Provider identifiers and 4-8,192 character API-key writes;
- exact backend enum including Linux `basic_text` and `unknown`;
- strict masked-only credential list/mutation/test responses;
- encrypted persistence document version 1 with bounded entry count and cipher
  text size;
- model metadata with positive integer and 10-million-token sanity bounds;
- optional bounded session context usage;
- bounded runtime-start credential array and private credential operations;
- model-list invalid-metadata diagnostic count;
- strict model/thinking selection and response session snapshots.

## 9. Tests added or changed

Unit coverage proves:

- plaintext never appears in persisted credential JSON or renderer metadata;
- create, update, delete, runtime decrypt, corrupt backup, unavailable storage,
  Linux `basic_text`, backend query failure, and key rotation behavior;
- requested/declared/application/remaining-context output limits;
- rejection of non-finite, negative, oversized, and inconsistent model metadata;
- old model/thinking restoration after mutation failure, cleared-model failure,
  no unnecessary rollback before mutation, and distinct rollback failure;
- a real Pi custom OpenAI-compatible Provider retains its `models.json`
  `maxTokensField` and emits `max_tokens: 32768`, never the alternative field or
  near-million output budget;
- secret-bearing private Agent requests are bounded while every response rejects
  a full key;
- credential IPC accepts only strict writes, masked reads, and explicitly
  confirmed deletion.

Electron E2E additionally proves:

- preload adds only the narrow `credentials` facade to the frozen bridge;
- actual platform safeStorage is available on the current macOS host;
- API-key create and provider connection test hot-sync into the real Pi runtime;
- the on-disk credential contains cipher text and never the entered key;
- a custom `models.json` Provider loads with name, image/reasoning capability,
  context window, max output, and unconfigured state;
- direct selection of that unconfigured model is rejected and the prior model
  remains selected;
- Models settings renders the real faux/custom catalog, masked key, and accurate
  storage security text;
- closing and relaunching Electron with the same userData decrypts and restores
  the Provider credential before model listing/testing;
- thinking selection is clamped by Pi for a non-reasoning model;
- explicit deletion removes the credential and hot-syncs the running worker.

## 10. Verification commands

- installed Pi package declaration/source/docs inspection for ModelRuntime,
  ModelConfig, Provider compatibility, credential store, session switching,
  context clamp, and OpenAI request generation;
- official Electron safeStorage documentation inspection;
- bundled offline pnpm `exec tsc --noEmit` during focused work;
- focused credential/model/protocol/IPC Vitest runs;
- bundled offline pnpm `run test:unit`;
- bundled offline pnpm `run build`;
- focused and complete Playwright Electron runs;
- comparison-only bundled offline pnpm `run test:visual`;
- bundled offline pnpm `peers check`;
- locale-key parity script;
- `git diff --check`, staged-diff, visual-baseline, mode-120000, and symlink
  hygiene checks.

## 11. Real result of each command

### Pi and safeStorage inspection

- Pi packages are fixed at 0.84.0. `ModelRuntime.create` composes built-ins,
  `models.json`, registered Providers, runtime credentials, and environment auth.
- Installed Pi source confirms `maxTokensField` is resolved from actual model
  compatibility and Pi subtracts estimated context plus a 4,096-token reserve.
- Electron's current API provides async availability, encrypt, decrypt, key
  rotation signaling, and Linux backend selection. `basic_text` is the documented
  unprotected fallback and is therefore marked degraded.
- The fixed built-in catalog contains two inconsistent entries: Hugging Face
  `thinkingmachines/Inkling-Small` and OpenRouter
  `openai/gpt-3.5-turbo-0613` declare `maxTokens > contextWindow`. Both are
  deliberately omitted and counted; source metadata was not rewritten.

### TypeScript, unit tests, and build

- Final production build ran its own `tsc --noEmit`; both passed.
- Focused Phase 9 unit run passed 4 files and 37 tests.
- Final unit suite passed 14 files and 102 tests in 796 ms.
- Production build transformed 38 Main modules and emitted protocol 21.23 kB,
  Agent Worker 57.05 kB, and Main 185.91 kB.
- Preload transformed 89 modules and emitted 192.27 kB.
- Renderer transformed 735 modules and emitted HTML 1.56 kB, initial CSS
  96.52 kB, initial JavaScript 2,054.29 kB, and unchanged lazy Terminal chunks
  of CSS 7.11 kB and JavaScript 568.98 kB.
- Locale parity passed with exactly 403 keys in each catalog.
- `pnpm peers check`: no peer dependency issues.

### Electron integration and visual regression

- The focused Keychain/custom-Provider/restart test passed in 4.8 s before the
  final auth-boundary assertion was added.
- In the complete Electron run, 7 tests passed. The credential test correctly
  rejected an unconfigured model, but its test assertion expected Playwright to
  preserve a custom Error property across `page.evaluate`; Playwright serialized
  it as a plain Error. After changing only the test to extract the code inside
  the page, the affected complete scenario passed in 4.5 s. Per repository
  policy, only the affected check was rerun; the other seven passing tests were
  not repeated.
- Final visual comparison passed all 8 approved macOS dark/light references in
  14.0 s. No baseline was regenerated or modified by the command.

### Repository checks

- `git diff --check` passed with no whitespace errors.
- The locale catalogs have no missing key on either side.
- No tracked visual baseline diff was produced and the normal visual command
  remained comparison-only.
- The staged diff is empty and the Git index contains no mode `120000` entry.
- Machine-local `.agents/skills` symlinks and their tracked-file deletion noise
  remain unstaged and untouched, as requested.
- Playwright result metadata remains ignored and is not a delivery source file.

## 12. UI files modified

- `src/App.tsx`
- `src/components/chat/Composer.tsx`
- `src/components/settings/ModelsSettings.tsx`
- `src/components/settings/SettingsLayout.tsx`
- `src/store/models.tsx`
- `src/main.tsx`
- both locale catalogs

No theme token, global CSS, three-column geometry, title/body/code scale, spacing,
radius, border, density, Markdown styling, ApprovalCard, ToolCallCard, or visual
baseline file was changed.

## 13. UI modification necessity

Phase 9 explicitly requires the existing model/provider settings and model
switcher to become functional. `ModelsSettings` replaces only the previous
placeholder inside the already approved Settings destination. It uses existing
`SettingSection`, `SettingRow`, Button, Select, Input, Badge, Tooltip, and
AlertDialog primitives and the frozen typography/tokens. The credential delete
confirmation is required because it removes persisted authentication state.

本阶段只把真实模型目录、会话模型与 Thinking 切换、上下文用量、凭据状态和安全存储操作接入现有 Header、Composer 与 Models 设置区域；未重做三栏布局，也未修改主题 Token、字号、间距、圆角、边框、Markdown 或卡片结构。

## 14. Visual regression result

Passed: all 8 approved macOS dark/light references. The default visual fixture
opens Appearance settings, so the new functional Models destination does not
alter the frozen screenshot. No baseline was regenerated or modified.

## 15. Mock data still in use

- Browser preview and visual tests intentionally retain the approved static
  model/provider/context fixture.
- Electron E2E uses Pi's real `ModelRuntime` and session with its official faux
  Provider for deterministic replies; the additional custom Provider is loaded
  from an actual `models.json` file.
- Resource/Skills/extension/MCP settings and detailed diagnostics remain Phase
  10. Logs remain a static/empty Inspector surface until that phase.

## 16. Known issues

- The installed upstream catalog currently contributes two invalid model entries;
  PiPilot shows a count and omits them instead of silently altering declarations.
- Live Provider testing uses the first valid model and can consume a minimal
  request. It is capped at 16 output tokens, zero retries, and ten seconds, but
  it is not a metadata-only health endpoint.
- OAuth login/logout UI is not introduced. Pi environment, models.json, and
  registered Provider auth still contribute to configured state; PiPilot's new
  encrypted repository manages user-entered API keys.
- Linux backend detection and warning behavior are unit/contract/UI-tested, but
  the current host exercised actual safeStorage only on macOS Keychain. Windows
  DPAPI and Linux libsecret/KWallet/basic_text require Phase 11/12 platform runs.
- Runtime provider keys necessarily exist transiently inside the isolated Agent
  Utility Process for Pi network calls. They are not persisted there, returned,
  placed in sessions, or emitted to logs, and are cleared on disposal.
- Model catalog refresh in this phase occurs on runtime/session changes and an
  explicit UI refresh. Automatic file watching for `models.json` is not added.
- Packaged safeStorage, Keychain prompts, hardened runtime, installers, and
  platform artifacts remain Phase 12 evidence.
- Bare Corepack pnpm remains unusable without registry access in this sandbox;
  verification used the bundled pnpm executable and existing lockfile.

## 17. Next phase plan

Phase 10 will make Pi resources and diagnostics real:

1. inspect installed Pi 0.84.0 `DefaultResourceLoader`, extension runner, Skill,
   prompt, context, package, MCP, and reload result APIs before implementation;
2. define bounded redacted resource metadata with global/project/package/custom
   source classification and per-resource enabled/loaded/error state;
3. add transactional resource reload that preserves the prior working session
   runtime when a replacement load fails;
4. bind project resources to the active canonical workspace and refresh them on
   workspace switch without exposing absolute paths;
5. surface compatible observational-memory and Hermes commands through Pi's
   resource system, not bespoke Renderer imports;
6. classify high-permission MCP capabilities, keep them disabled by default,
   and keep tokens out of project configuration and Renderer state;
7. test partial failure, redaction, reload rollback, source classification,
   workspace switching, Electron behavior, and unchanged frozen visual output.
