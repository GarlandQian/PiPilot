# Phase 1 Report - Electron Secure Foundation

Date: 2026-08-07

> **Historical snapshot (2026-08-07):** This report preserves the evidence and
> assumptions of Phase 1. It is not current product or release authority. See
> [the documentation index](README.md), [Architecture](ARCHITECTURE.md),
> [Packaging](PACKAGING.md), and [Test Matrix](TEST_MATRIX.md).

## 1. Phase name

Phase 1 - Electron secure foundation.

## 2. Completed work

- Selected Electron 43.3.0 with electron-vite 5.0.0 after checking the
  installed package types and current upstream documentation.
- Added Electron Main, sandbox-compatible CommonJS preload, and renderer build
  targets without moving or redesigning the existing React tree.
- Added a controlled `pipilot://app/` production protocol with path containment
  and traversal rejection instead of using `file://`.
- Enabled global and per-window sandboxing, context isolation, Node isolation,
  web security, disabled webviews/experimental features/WebSQL, and denied
  unrequested permissions.
- Added restrictive development and production CSP policies. The original
  inline theme bootstrap was moved to a same-origin static script.
- Added exact-origin navigation checks, popup denial, and Main-owned external
  opening limited to credential-free HTTP/HTTPS URLs.
- Added a typed `window.pipilot` facade with `app`, `window`, and `shell`
  business APIs. Raw `ipcRenderer` and generic send/invoke methods are absent.
- Added UUID-correlated request envelopes, structured errors, request/result
  runtime schemas, response validation, exact-main-frame sender validation,
  and preload-side result validation.
- Added atomic window-state persistence under `userData`, including bounds,
  maximized state, display-disconnect fallback, size/position clamping, and a
  synchronous final close write to avoid exit races.
- Added unit coverage for URL/protocol policy, IPC validation/sender checks,
  and window-state normalization/persistence.
- Added a real Electron launch/restart smoke test and reran the eight frozen UI
  comparisons with zero changed pixels.

Implementation follows the current Electron guidance for
[security](https://www.electronjs.org/docs/latest/tutorial/security),
[sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox),
[preload ESM limitations](https://www.electronjs.org/docs/latest/tutorial/esm),
[contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge), and
[custom protocols](https://www.electronjs.org/docs/latest/api/protocol/), plus
the [electron-vite 5 guide](https://electron-vite.org/guide/).

## 3. Modified files

- `.gitignore`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `tsconfig.json`
- `electron.vite.config.ts`
- `vitest.config.ts`
- `playwright.config.ts`
- `playwright.electron.config.ts`
- `index.html`
- `public/theme-bootstrap.js`
- `src/main/index.ts`
- `src/main/ipc/register-app-ipc.ts`
- `src/main/ipc/validated-handler.ts`
- `src/main/ipc/validated-invoke.ts`
- `src/main/security/app-protocol.ts`
- `src/main/security/app-protocol-path.ts`
- `src/main/security/navigation.ts`
- `src/main/security/session-security.ts`
- `src/main/security/url-policy.ts`
- `src/main/windows/create-main-window.ts`
- `src/main/windows/window-state.ts`
- `src/preload/index.ts`
- `src/shared/ipc/contracts.ts`
- `src/shared/pipilot-api.ts`
- `src/vite-env.d.ts`
- `src/components/chat/markdown/MarkdownLink.tsx`
- `tests/unit/ipc-contracts.test.ts`
- `tests/unit/url-policy.test.ts`
- `tests/unit/window-state.test.ts`
- `tests/electron/pipilot.electron.spec.ts`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/PHASE_1_REPORT.md`

## 4. Purpose of each modified file

| File/group | Purpose |
| --- | --- |
| `package.json`, lockfile, workspace config | Desktop identity, scripts, locked dependencies, and explicit Electron install-script allowlist |
| `electron.vite.config.ts` | Main/preload/renderer builds, sandbox preload bundling, and development server |
| `playwright.config.ts` | Preserve explicit browser mock mode and frozen visual test server |
| `vitest.config.ts`, Electron Playwright config | Isolated unit and Electron E2E runners |
| `index.html`, `public/theme-bootstrap.js` | CSP-compatible initial theme without changing its behavior |
| `src/main/index.ts` | App lifecycle, single-instance policy, sandbox, protocol/session/IPC registration, and macOS activation |
| `src/main/security/*` | Trusted URL policy, controlled protocol, CSP/permissions, navigation, popup, and external-link guards |
| `src/main/ipc/*` | Sender-authorized, schema-validated handlers and safe error mapping |
| `src/main/windows/*` | Secure BrowserWindow creation and atomic display-aware state persistence |
| `src/preload/index.ts` | Narrow contextBridge facade and preload-side validation/correlation |
| `src/shared/*` | Channels, envelopes, schemas, domain responses, structured errors, and facade types |
| `MarkdownLink.tsx` | Route Electron links through Main while retaining browser mock fallback |
| `tests/unit/*` | Stable security, contract, and persistence regressions |
| `tests/electron/*` | Real process isolation, bridge, navigation, popup, URL, persistence, and restart evidence |
| `.gitignore` | Ignore `out/` and transient test artifacts while preserving reviewed baselines |
| architecture/plan/report docs | Record the selected implementation and completed phase evidence |

## 5. Dependencies added and reason

- `electron@43.3.0` (development): the actual desktop runtime.
- `electron-vite@5.0.0` (development): one supported build/dev boundary for
  Electron Main, preload, and the existing Vite renderer.
- `vitest@4.1.10` (development): focused Node unit tests now that security,
  persistence, and shared contract modules exist.
- `zod@4.4.3` (runtime): shared runtime validation for every current IPC
  request, response, result envelope, structured error, and persisted window
  state.

`electron-vite@5.0.0` declares Vite support through Vite 7, while the previous
renderer used Vite 8 and `@vitejs/plugin-react` 6. The build pair was therefore
changed to `vite@7.3.6` and `@vitejs/plugin-react@5.2.0`; final
`pnpm peers check` reports no peer dependency issues. No packager, updater,
native PTY, Pi SDK, or overlapping schema/test package was added.

The existing `@playwright/test` remains necessary for repository-owned visual
and Electron E2E assertions. Playwright MCP remains the interactive inspection
surface and is not duplicated by this runner. No Playwright browser bundle was
installed; browser visual tests use local stable Chrome.

## 6. New IPC

| Channel | Facade | Request | Response/behavior |
| --- | --- | --- | --- |
| `pipilot:app:get-info` | `window.pipilot.app.getInfo()` | UUID request context | PiPilot/version/platform/Electron/mode metadata |
| `pipilot:window:get-state` | `window.pipilot.window.getState()` | UUID request context | focused/fullScreen/maximized booleans |
| `pipilot:shell:open-external` | `window.pipilot.shell.openExternal(url)` | UUID context plus bounded URL | Main opens only validated HTTP/HTTPS; other schemes are rejected |

Every handler requires the current trusted main frame, validates input before
calling its implementation, validates the response before returning it, and
returns a correlated success/error envelope. The preload validates again and
never exposes a channel name or raw Electron API.

## 7. New shared types

- `RequestContext`
- `AppError`
- `IpcResult<T>`
- `IpcContract<TRequest, TResponse>`
- `IpcChannel`
- `AppInfo`
- `WindowSnapshot`
- `OpenExternalResponse`
- `PiPilotApi`
- `PiPilotApiError`

## 8. New runtime schemas

- strict request-context schema with UUID correlation;
- strict structured application-error schema;
- discriminated success/error result schemas;
- strict app-info, window-snapshot, and external-open response schemas;
- strict request schemas for all three channels;
- versioned strict window-bounds/maximized persistence schema.

Malformed requests never reach business handlers. Malformed handler responses
become safe `IPC_INVALID_RESPONSE` results. Unknown exceptions retain their
full stack only in Main diagnostics and become a redacted renderer error.

## 9. Tests added

Vitest: 3 files, 16 tests.

- exact loopback development origin and production scheme/host matching;
- external URL protocol/credential rejection;
- protocol root/asset mapping and host, escape, traversal, and backslash
  rejection;
- correlated valid IPC success;
- untrusted sender rejection before handler execution;
- invalid request and invalid response rejection;
- safe typed Main error mapping;
- same-main-frame and trusted-URL sender enforcement;
- valid multi-display restoration, oversized/partial clamping, and disconnected
  display fallback;
- atomic window-state round trip and corrupt/schema-invalid fallback.

Electron E2E: 1 full launch/restart test.

- production `pipilot://app/` load and PiPilot title;
- renderer has no `process` or `require`;
- contextBridge facade is frozen and contains only `app`, `shell`, `window`;
- renderer process reports OS-level sandboxing;
- typed app/window calls work;
- `file://` external request returns structured rejection from Main;
- cross-origin navigation and `data:` popup are blocked;
- window bounds persist to temporary `userData` and restore after restart.

The existing eight visual scenarios remain unchanged.

## 10. Verification commands

- `./node_modules/.bin/electron --version`
- `pnpm peers check`
- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm build`
- `pnpm test:electron`
- `pnpm test:visual`
- fixed 1440 x 900 in-app browser DOM/screenshot inspection
- focused `git diff --check`, ignore, build-output, and symlink-index checks

## 11. Real result of each command

### Dependency/runtime checks

- Electron first-run binary download completed and
  `./node_modules/.bin/electron --version` returned `v43.3.0`.
- `pnpm peers check` initially found electron-vite/Vite 8 incompatibility.
  After selecting Vite 7.3.6 and React plugin 5.2.0, it returned
  `No peer dependency issues found`.
- pnpm required an explicit `electron: true` build-script allowlist entry; no
  global script permission was enabled.

### TypeScript and unit tests

- Initial TypeScript run found literal/generic contract typing and a removed
  Electron inspection API in the E2E test. Those were corrected against the
  installed types.
- Final `pnpm typecheck`: passed with no diagnostics.
- Final `pnpm test:unit`: 3 files passed, 16 tests passed, 189 ms.

### Electron build

- First build reached Main output but electron-vite's experimental
  `isolatedEntries` plugin called a TTY-only cursor API in the non-TTY runner.
  This single-entry preload does not need isolated entry splitting, so the
  experimental option was removed while dependency externalization remained
  disabled.
- Final `pnpm build`: passed.
  - Main: 12 modules, `out/main/index.js` 19.26 kB.
  - Preload: 81 modules, `out/preload/index.cjs` 130.97 kB.
  - Renderer: 638 modules, HTML 1.56 kB, CSS 109.86 kB, JS 1,902.75 kB before
    release minification.

### Electron launch test

- First launch correctly isolated Node but exposed no facade because the
  preload was emitted as ESM. Current Electron documentation states sandboxed
  preloads do not support ESM, so preload output was changed to bundled CJS;
  sandboxing was not weakened.
- A subsequent run showed that contextBridge normalizes custom JavaScript
  `Error` objects. The facade now throws a serializable structured error so
  code/source/requestId survive the bridge.
- Final `pnpm test:electron`: 1 passed, 0 failed, 3.5 seconds.

### Visual/browser checks

- Initial sandboxed visual command could not bind `127.0.0.1:4173` (`EPERM`).
- Approved local-server run of `pnpm test:visual`: 8 passed, 0 failed,
  14.9 seconds, with baseline updates disabled.
- In-app browser reload, semantic DOM inspection, and 1440 x 900 screenshot
  inspection showed the approved three-column waiting-approval UI without an
  unexpected visual change.

### Repository checks

- Focused whitespace, ignore, build-output, and Git index symlink checks pass.
- `out/`, the local pnpm store, test reports, and future MCP artifacts are
  ignored. Four historical `.playwright-mcp` files were already tracked and are
  locally deleted in the pre-existing dirty worktree; those deletion records
  were not staged or otherwise changed by this phase.
- The Git index contains no mode `120000` symlink entry. Local
  `.agents/skills/` symlinks remain ignored and their tracked deletion noise was
  not staged.

## 12. UI files modified

- `index.html`
- `public/theme-bootstrap.js`
- `src/components/chat/markdown/MarkdownLink.tsx`
- `src/vite-env.d.ts` (type declaration only)

No layout component, theme token, typography rule, spacing rule, locale file,
ToolCallCard, ApprovalCard, or visible string was changed.

## 13. UI modification necessity

The inline initial-theme script had to become a same-origin static script so
`script-src 'self'` can remain strict without `unsafe-inline`. Its logic is
unchanged. Markdown links had to use the typed Main-owned external-open API in
Electron; explicit browser mock mode retains the existing new-tab fallback.

These are security wiring changes, not a redesign. No new user-visible text was
introduced, so no locale catalog addition was required.

## 14. Visual regression result

Passed: 8 of 8 macOS references, zero failed comparisons, no baseline update.
The scenarios remain dark/light idle, running, waiting approval, and settings
at 1440 x 900 CSS pixels with the frozen deterministic environment.

## 15. Mock data still in use

All business features intentionally remain mocked in the renderer:

- settings still use renderer localStorage until Phase 2;
- workspace/recent-project data;
- session list, titles, and actions;
- model/provider/context data;
- messages and streaming transitions;
- tool calls and approval lifecycle;
- files, diffs, terminal, and logs.

The Electron lifecycle, security policy, controlled protocol, typed IPC,
external-link path, and window-state persistence are real. Pi SDK remains
absent by phase order.

## 16. Known issues

- No Pi SDK, Agent Utility Process, real settings/workspaces/sessions, PTY,
  secret store, packaging, signing, updater, or release fuse configuration yet.
- Google Fonts remain remote to preserve the approved pixels; CSP allows only
  their existing HTTPS stylesheet/font origins. Packaging must make reviewed
  font assets available without a renderer network dependency.
- electron-vite's renderer preset currently emits an unminified 1.90 MB
  JavaScript bundle. Release optimization/code splitting is deferred until it
  can be measured without destabilizing the frozen UI.
- Invalid/corrupt window state falls back safely but is not backed up because it
  is disposable placement metadata. Phase 2 applies backup/migration recovery
  to authoritative application settings.
- Fuses and packaged-app smoke testing belong to Phases 12-13; this phase proves
  the unpackaged production build through the Electron runtime only.

## 17. Next phase plan

Phase 2 will migrate settings authority without changing Settings UI:

1. inspect the current settings store and final Main/preload contracts;
2. add versioned defaults, deep merge, migrations, and an atomic Main
   SettingsRepository under `userData`;
3. back up corrupt settings and recover defaults with redacted diagnostics;
4. add validated get/update/reset/subscribe APIs and adapters for explicit web
   mock versus Electron mode;
5. preserve immediate theme/font/density/locale application and pre-paint
   theme behavior;
6. verify repository, migration, corruption, IPC, restart, Electron E2E, and
   all frozen visual scenarios.

Pi SDK remains out of scope until Phase 3.
