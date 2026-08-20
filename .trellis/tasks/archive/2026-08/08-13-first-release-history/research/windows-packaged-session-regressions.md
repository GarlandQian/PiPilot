# Research: Windows packaged project-session regressions after v0.0.1

- Query: Diagnose the public Windows v0.0.1 reports that a populated project has no project-directed “new task” action and that clicking an existing project session does not hydrate its messages/useable state. Trace Sidebar/App/workspace/session catalog/activation/local Pi host, compare an fnm-installed npm `pi.cmd` with packaged smoke fixtures, and define the smallest regression coverage.
- Scope: mixed
- Date: 2026-08-14

## Findings

### Executive diagnosis

There are two independent defects.

1. **Definite renderer interaction defect:** a populated project has no project-directed creation action. `ProjectChildren` renders `Start task` only in the `ready` + zero-row branch; once one session exists it renders only `ConversationList`. The project `...` menu contains only Open and Pin/Unpin. The top `NewConversationControl` targets `workspace.activeScope`, not the project row the user is inspecting, so it is not a substitute for “new task in this project.” Evidence: `src/components/layout/SessionList.tsx:394-411`, `src/components/layout/SessionList.tsx:514-539`, `src/components/frame/SessionsPanel.tsx:54-100`, and `src/App.tsx:649-658`.

2. **High-confidence Windows process-boundary defect:** the Windows launcher recognizes only `node_modules\\.bin\\*.cmd` as an npm command shim requiring a second layer of cmd.exe metacharacter escaping. An fnm/npm global install puts the generated `pi.cmd` at the active Node installation root (for example `...\\fnm\\node-versions\\v24.18.0\\installation\\pi.cmd`) and its package under `installation\\node_modules\\@earendil-works\\pi-coding-agent`; that `pi.cmd` is still an npm `cmd-shim` proxy using `%*`, but it does **not** match `WINDOWS_NODE_MODULES_SHIM`. PiPilot therefore applies only generic `.cmd` escaping to the nested batch launch. Simple startup arguments can work, while the first path-shaped activation argument, `--session <absolute-jsonl-path>`, can be altered by the second cmd.exe parse (spaces and cmd metacharacters are especially diagnostic). Pi then cannot open/confirm the exact selected file, so Main never returns a valid `{ scope, generation, sessionId }` activation and renderer hydration cannot load `get_messages`. Evidence: `src/main/local-pi/local-pi-spawn.ts:3-18`, `src/main/local-pi/local-pi-spawn.ts:33-47`, `src/main/local-pi/local-pi-runtime-host.ts:459-489`, and `src/main/conversations/official-pi-session-activation-service.ts:133-200`.

The second conclusion is based on a source-level comparison with the real npm/fnm layout and npm `cmd-shim` implementation. It still needs the native Windows reproducer below before claiming the exact failing character/path on the reporter's machine. The renderer hydration code itself already keys the operation by scope/generation/session and the existing Electron tests prove that path with a direct `.mjs` executable; the untested Windows-only boundary is the real global npm `.cmd` shim plus `--session` path.

### Complete flow and failure boundary

#### Project-directed creation

The intended callback exists all the way down:

- `App` supplies `onStartProjectTask(workspaceId)`, which calls `workspace.newSession({ kind: 'project', workspaceId })` (`src/App.tsx:653-658`).
- `SessionsPanel` passes that callback to `ProjectNavigationGroup` (`src/components/frame/SessionsPanel.tsx:307-330`).
- `ProjectChildren` exposes it only when `scopedItems.length === 0` (`src/components/layout/SessionList.tsx:394-411`).
- When rows exist, the branch contains only `ConversationList`; no adjacent plus button or menu item remains (`src/components/layout/SessionList.tsx:396-403`).
- The project menu has Open and Pin/Unpin only (`src/components/layout/SessionList.tsx:525-539`).

This is not a store or IPC omission. The action is already implemented; the project row loses every route to it as soon as its catalog becomes non-empty. Minimal implementation handoff: keep a project-scoped `New project task` action available for every available project, preferably in the project `...` menu and/or a stable project-child action independent of row count. Do not route it through the active-scope-only top button.

#### Existing-session activation and hydration

The normal cross-layer path is structurally correct:

1. A row click starts an App-owned opening operation and pins its selection token/scope (`src/App.tsx:278-307`).
2. App awaits `workspace.openSession(scope, token)` and records only Main's exact activation identity (`src/App.tsx:377-405`).
3. Workspace invokes preload `sessionCatalog.open`, applies the returned activation immediately, and deliberately starts secondary refresh in the background (`src/store/workspace.tsx:758-779`; preload bridge at `src/preload/index.ts:297-301`).
4. Main resolves the opaque catalog token to canonical cwd/session file and replaces Pi with `--session <absolute-file>` (`src/main/conversations/official-pi-session-catalog.ts:817-845`; `src/main/conversations/official-pi-session-activation-service.ts:133-175`).
5. Main requires Pi to report the same session ID and canonical session file before returning activation (`src/main/conversations/official-pi-session-activation-service.ts:274-309`).
6. PiRpc hydrates state, messages, models, commands, stats, and entries; async commits require the same scope/generation/session (`src/store/pi-rpc.tsx:659-769`).
7. App keeps the conversation loading until that exact target is ready (`src/store/pi-rpc.tsx:319-357`; `src/App.tsx:341-375`).

Therefore, if a Windows `.cmd` launch corrupts or drops the explicit session argument, the failure occurs before transcript projection: Pi opens the wrong/new session or fails to start, confirmation fails, and the exact activation/hydration target never settles.

### Why the fnm/npm `pi.cmd` differs from the packaged fixture

Pi 0.84.1 declares `"bin": { "pi": "dist/cli.js" }`. npm generates a Windows `pi.cmd` at the global prefix root and a package tree below `node_modules`. With fnm, global packages are version-specific under the active Node installation, so the relevant shape is:

```text
...\\fnm\\node-versions\\v24.18.0\\installation\\
├── node.exe
├── pi.cmd
└── node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js
```

The npm-generated batch shim selects `%dp0%\\node.exe` when present and ends by invoking the CLI with `%*`. That is a nested cmd parser/proxy even though the shim path is not `node_modules\\.bin`. PiPilot's classifier is path-based rather than content/origin-based:

```ts
const WINDOWS_NODE_MODULES_SHIM = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/iu
const doubleEscape = WINDOWS_NODE_MODULES_SHIM.test(commandPath)
```

The packaged smoke instead writes this simplified fixture at a temporary root:

```cmd
@echo off
"<absolute test node.exe>" "<fake-pi.mjs>" %*
```

See `tests/packaged/pipilot.packaged.spec.ts:210-225`. It does not reproduce npm's `IF EXIST "%dp0%\\node.exe"`, `_prog`, `endLocal ... &`, or real global-prefix placement. More importantly, that smoke only verifies projectless startup and runtime restart (`tests/packaged/pipilot.packaged.spec.ts:301-313`). `workspacePath` is allocated and deleted but never selected or opened (`tests/packaged/pipilot.packaged.spec.ts:210-213`, `tests/packaged/pipilot.packaged.spec.ts:324-326`). It never calls `conversation.new({ kind: 'project' })`, `sessionCatalog.open`, `--session`, `get_messages`, or checks rendered history.

### Exact affected files / implementation handoff

- `src/components/layout/SessionList.tsx`
  - Keep `onStartProjectTask(project.id)` reachable when `scopedItems.length > 0`.
  - Add the project-scoped action to the `...` menu and/or a stable child-row control. The menu is the smallest change and already receives the project ID.
- `src/components/frame/SessionsPanel.tsx`
  - Props already carry `onStartProjectTask`; likely no store/API change is needed unless the chosen visual placement moves ownership.
- `src/main/local-pi/local-pi-spawn.ts`
  - Do not infer “npm shim” solely from `node_modules\\.bin`. A global fnm/npm `pi.cmd` is the real supported Windows shape.
  - Preferred low-risk direction: use the already maintained `cross-spawn@7.0.6` available with supported Pi 0.84.1 only if repository dependency ownership is acceptable, or extend the helper with an explicit/tested npm-global-shim strategy. Avoid `shell: true` with unescaped user paths.
  - If retaining custom escaping, the native test must prove exact argv through a real cmd-shim-shaped wrapper for both version probing and RPC `--session` startup; do not merely assert a caret substring.
- `tests/packaged/pipilot.packaged.spec.ts`
  - Replace/augment the Windows fixture with a real npm `cmd-shim` shape under an fnm-like installation root.
  - Actually use `workspacePath`, seed one official v3 project session, activate/click it once, and assert restored history plus exact traced `--session` argv.
- `tests/unit/local-pi-executable.test.ts`
  - The current test only exercises a `node_modules\\.bin\\pi.cmd` string and asserts that the generated command contains `^^^&` (`tests/unit/local-pi-executable.test.ts:14-28`). Add the fnm global-prefix path as a distinct case. A pure string assertion is useful but is not sufficient evidence of cmd.exe round-trip behavior.
- `tests/electron/pipilot.electron.spec.ts`
  - Existing project-session tests are valuable renderer/catalog coverage but launch `tests/fixtures/fake-pi.mjs` directly, not a Windows `.cmd` shim (`tests/electron/pipilot.electron.spec.ts:262-426`, `tests/electron/pipilot.electron.spec.ts:446-1020`). Keep them; add the native packaged boundary rather than duplicating all renderer scenarios.

### Minimal reproducible Windows-shaped test

The minimum release-blocking regression should run on the existing `windows-2025` package job and exercise one click end-to-end:

1. Build an fnm-shaped fixture directory such as `...\\fnm\\node-versions\\v24.18.0\\installation`.
2. Put a cmd-shim-shaped `pi.cmd` there. It should use the npm shim's `_prog`/`%dp0%\\node.exe`/`%*` structure, not the current two-line wrapper. Use a session/workspace path containing spaces plus at least one cmd metacharacter, e.g. `Project (A) & Notes`, so a missing second escape is deterministic.
3. Seed/select that workspace and an official v3 JSONL session whose header cwd exactly equals the canonical workspace. Seed messages that are unique to the selected session.
4. Start packaged PiPilot with `piExecutablePath` pointing at the fnm-shaped `pi.cmd`.
5. Expand the populated project, verify its project menu still offers `New project task`, then click the existing session **once**.
6. Assert:
   - the fake Pi trace received exactly `--mode rpc --approve --session <exact absolute file>`;
   - the selected session's unique user/assistant messages render;
   - `Loading conversation…` disappears and the Composer is connected/useable;
   - the project-directed new-task action remains visible despite the existing row.

A smaller launcher-only native test can execute `createLocalPiSpawnInvocation()` through the real cmd-shim fixture and echo argv, but it must be supplemented by the packaged one-click hydration test because the release failure crosses Main, preload, renderer, and persisted session state.

### Why all existing gates missed this repeated release bug

- **UI conditional was never asserted.** Existing tests select a populated project session, but no test asks whether a populated project's own menu/area still exposes `New project task`. The code path for empty catalogs made the feature appear present during manual/empty-state checks.
- **Electron E2E is macOS-only in the release verification job.** `.github/workflows/release.yml:92-125` runs all Electron E2E on `macos-26`. Those tests launch `fake-pi.mjs` directly, so they validate the renderer activation/hydration identity but cannot validate Windows batch semantics.
- **Windows runs only the shallow packaged smoke.** `.github/workflows/release.yml:137-213` does run `pnpm test:packaged` on `windows-2025`, but the smoke remains projectless and restart-only.
- **The packaged Windows fixture is not an npm/fnm shim.** It uses an absolute Node executable and a two-line `%*` wrapper, so it omits the real shim's nested parser and global-prefix placement.
- **The only launcher unit test encodes the wrong installation shape.** It tests `C:\\Program Files\\node_modules\\.bin\\pi.cmd`, while fnm's global shim is at the Node installation root. It verifies an implementation string, not the argv observed by a child process.
- **No packaged test crosses the selected-session boundary.** The smoke does not create/open a project, does not seed/list/click a session, does not issue `--session`, and does not assert `get_messages` or visible transcript content. Thus Windows packaging could be green while the principal navigation workflow was unusable.

### Files found

- `src/components/layout/SessionList.tsx` — project/session sidebar rows, conditional empty-state `Start task`, and project menu.
- `src/components/frame/SessionsPanel.tsx` — active-scope new control and project navigation assembly.
- `src/App.tsx` — opening-operation identity, project-directed new callback, and hydration settlement.
- `src/store/workspace.tsx` — catalog state, activation application, and `sessionCatalog.open` adapter call.
- `src/store/pi-rpc.tsx` — exact scope/generation/session hydration and message projection.
- `src/preload/index.ts` — validated conversation/session catalog IPC bridge.
- `src/main/conversations/conversation-context-service.ts` — serialized new/open conversation lifecycle.
- `src/main/conversations/official-pi-session-catalog.ts` — opaque token to canonical cwd/session-file resolution.
- `src/main/conversations/official-pi-session-activation-service.ts` — host replacement and exact session ID/file confirmation.
- `src/main/local-pi/local-pi-spawn.ts` — Windows `.cmd` escaping/classification.
- `src/main/local-pi/local-pi-runtime-host.ts` — actual RPC process spawn and `--session` argv.
- `src/main/local-pi/local-pi-executable.ts` — discovery/version probe using the same spawn helper.
- `tests/packaged/pipilot.packaged.spec.ts` — native package smoke with the non-representative wrapper and unused workspace.
- `tests/electron/pipilot.electron.spec.ts` — robust project session hydration tests against a direct `.mjs` executable.
- `tests/unit/local-pi-executable.test.ts` — current `.bin`-only launcher assertion.
- `.github/workflows/release.yml` — macOS full Electron verification and per-platform shallow packaged smoke.

### External references

- Pi 0.84.1 npm metadata (`bin.pi = dist/cli.js`, version, package layout): `https://registry.npmjs.org/%40earendil-works%2Fpi-coding-agent/0.84.1`
- Pi 0.84.1 `SessionManager` source at published git head `53fa77c` (default Windows-safe cwd encoding, absolute session open, and `sessionFile` ownership): `https://raw.githubusercontent.com/earendil-works/pi-mono/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/core/session-manager.ts`
- Pi 0.84.1 Windows path normalization: `https://raw.githubusercontent.com/earendil-works/pi-mono/53fa77ccd8a279eb87e92294ef3687b03ff80112/packages/coding-agent/src/utils/paths.ts`
- npm `cmd-shim` implementation showing global-root `.cmd`, `%dp0%\\node.exe`, and `%*` proxy behavior: `https://raw.githubusercontent.com/npm/cmd-shim/main/lib/index.js`
- `cross-spawn` Windows parser/escaping reference, including its `.bin` shim special case: `https://raw.githubusercontent.com/moxystudio/node-cross-spawn/master/lib/parse.js` and `https://raw.githubusercontent.com/moxystudio/node-cross-spawn/master/lib/util/escape.js`
- fnm issue documenting version-specific global packages under `node-versions/<version>/installation`: `https://github.com/Schniz/fnm/issues/109`

### Related specs

- `.trellis/spec/backend/local-pi-rpc.md` — exact RPC spawn/`--session` contract and Windows executable discovery.
- `.trellis/spec/backend/official-pi-session-catalog.md` — opaque selection, exact canonical session confirmation, and one-click activation requirements.
- `.trellis/spec/backend/conversation-context.md` — scope ownership and project/projectless activation.
- `.trellis/spec/frontend/official-pi-renderer.md` — exact scope/generation/session hydration identity and one presentation discriminator.
- `.trellis/spec/frontend/state-management.md` — scope-aware async hydration guards.
- `.trellis/spec/guides/cross-layer-thinking-guide.md` — visible capability lifetime and activation/hydration boundary checks.

## Caveats / Not Found

- No reporter-side Windows log, exact fnm path, or failing session path was available in the worktree. The global npm-shim classification mismatch is concrete, and it precisely explains why startup can pass while `--session` activation fails, but the exact character mangled on the reporter's machine must be captured by the proposed native argv trace.
- The current source already contains prior scope-aware hydration and one-click catalog fixes. I found no remaining platform-neutral renderer race that better explains a Windows-only report than the untested `.cmd` activation boundary.
- I did not execute a native Windows test from the macOS workspace. No product files were changed.
