# Phase 8 Report - Real Terminal

Date: 2026-08-08

> **Historical snapshot (2026-08-08):** This report preserves the evidence and
> assumptions of Phase 8. It is not current product or release authority. See
> [the documentation index](README.md), [Architecture](ARCHITECTURE.md),
> [Packaging](PACKAGING.md), and [Test Matrix](TEST_MATRIX.md).

## 1. Phase name

Phase 8 - Real workspace-bound manual PTY in the frozen Terminal panel.

## 2. Completed work

- Confirmed that the repository contained no PTY, xterm, or equivalent terminal
  dependency and that the existing `TerminalPanel` was a local text/input mock.
- Verified the current official node-pty, xterm.js, addon-fit, Electron native
  module, and `@electron/rebuild` guidance before selecting stable releases.
- Added a Main-owned `TerminalService`; Renderer never imports Node, node-pty,
  child-process APIs, native bindings, absolute paths, or raw IPC.
- Added canonical active-workspace and relative-cwd resolution with traversal,
  missing directory, non-directory, workspace replacement, and symlink-escape
  rejection before spawning and before later input/resize/kill operations.
- Added safe Main platform-shell selection: configured executable shell with
  login mode on macOS/Linux, `ComSpec` with PowerShell fallback on Windows, and
  a non-packaged deterministic `/bin/sh` override used only by Electron tests.
- Added a bounded inherited environment that removes PiPilot internals,
  Node/Electron injection variables, and secret-shaped key/token/password/
  credential variables while setting terminal identity and color capabilities.
- Added one reusable terminal per workspace, a four-terminal process cap,
  serialized concurrent creation, and a lazy native-module load that fails
  without taking down the Main window.
- Added typed create, input, resize, kill, output, and exit operations. PTY
  stdout/stderr intentionally arrive as one `stream: "pty"` sequence, matching
  actual pseudoterminal semantics.
- Added 64 KiB input/event limits, 16 ms output batching, native pause/resume
  backpressure, a 1 MiB pending/replay bound, explicit output truncation, and
  sequence-consistent replay without duplicate prompt/output on UI remount.
- Added graceful HUP termination, 1.5-second grace, forced termination fallback,
  per-workspace cleanup on switch, and awaited Agent/PTY cleanup on app quit.
- Added a real xterm.js surface with fit-based dimensions, ANSI/TUI keyboard
  input, direct interactive focus, screen-reader labels, 5,000-line scrollback,
  existing bottom command entry, localized startup/error/exit/truncation state,
  and command-triggered restart after process exit.
- Applied live existing `monoFontFamily`, `codeFontSize`, theme, code-ligature,
  and word-wrap settings. Disabling wrap retains at least 120 columns and allows
  horizontal inspection instead of forcing the narrow panel width.
- Lazy-loaded the xterm implementation only after the real Electron Terminal tab
  is selected. Browser mock/visual mode retains the approved static Terminal DOM.
- Kept manual terminal commands completely separate from Agent Shell approvals;
  direct user input never creates an ApprovalCard or persistent permission rule.
- Added all new visible strings to both `zh-CN` and `en-US` catalogs.
- Added exact pnpm native-build policy plus `rebuild:native` and `postinstall`
  scripts. Rebuilt node-pty successfully against Electron 43 on macOS arm64.

## 3. Modified files

- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `src/shared/terminal.ts`
- `src/shared/ipc/contracts.ts`
- `src/shared/pipilot-api.ts`
- `src/main/terminal/terminal-service.ts`
- `src/main/ipc/register-terminal-ipc.ts`
- `src/main/ipc/register-workspace-ipc.ts`
- `src/main/index.ts`
- `src/preload/index.ts`
- `src/renderer/adapters/workspace-adapter.ts`
- `src/components/inspector/RealTerminalPanel.tsx`
- `src/components/inspector/TerminalPanel.tsx`
- `src/components/inspector/InspectorPanel.tsx`
- `src/i18n/locales/en-US.json`
- `src/i18n/locales/zh-CN.json`
- `tests/unit/terminal-service.test.ts`
- `tests/unit/ipc-contracts.test.ts`
- `tests/electron/pipilot.electron.spec.ts`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/PHASE_8_REPORT.md`

## 4. Purpose of each modified file

| File/group | Purpose |
| --- | --- |
| package/lock/workspace policy | Stable terminal/runtime dependencies, exact lock, allowed native build, Electron ABI rebuild scripts |
| shared terminal/contracts/API | Limits, session/action/event schemas, named channels, and narrow typed facade |
| Main terminal service | Canonical cwd, platform shell, safe environment, PTY ownership, batching, replay, backpressure, limits, and cleanup |
| Main terminal/workspace/app IPC | Trusted sender handlers, safe errors/events, switch cleanup, initialization, and awaited quit cleanup |
| preload and adapter | Runtime-validated terminal invokes/events without raw IPC or child-process access |
| real/static Inspector terminal components | Lazy real xterm, settings, input/restart behavior, and disabled no-workspace state while retaining browser fixture |
| locale catalogs | Bilingual terminal lifecycle, accessibility, restart, and truncation strings |
| unit/Electron tests | Contract, path, shell, env, lifecycle, stream, settings, permission separation, switch, and process cleanup evidence |
| docs | Implemented architecture, completion state, exact evidence, limitations, and Phase 9 handoff |

## 5. Dependencies added and reason

| Dependency | Version | Scope | Exact purpose |
| --- | --- | --- | --- |
| `node-pty` | 1.1.0 | production | Cross-platform native pseudoterminal, process I/O, resize, exit, and kill |
| `@xterm/xterm` | 6.0.0 | production | Maintained ANSI/VT terminal renderer, input, accessibility, and terminal buffer |
| `@xterm/addon-fit` | 0.11.0 | production | Official xterm container measurement and columns/rows fitting |
| `@electron/rebuild` | 4.2.0 | development | Rebuild native modules against the installed Electron ABI |

Current React, CSS, and the mock text component cannot emulate a PTY, curses,
terminal control sequences, Unicode cell widths, or native resize/process-tree
semantics. These dependencies are small in capability overlap and are maintained
by the xterm.js/node-pty/Electron projects used by VS Code and other terminals.

Sources inspected:

- <https://github.com/microsoft/node-pty>
- <https://xtermjs.org/>
- <https://xtermjs.org/docs/guides/using-addons/>
- <https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules/>
- <https://github.com/electron/rebuild>

A Playwright MCP is unrelated to application runtime PTYs and cannot replace
these shipped dependencies. The repository Playwright package likewise remains
necessary for checked-in E2E/visual tests and CI; no browser binary was added.

## 6. New IPC

| Channel | Preload facade | Result |
| --- | --- | --- |
| `pipilot:terminal:create` | `terminal.create(workspaceId, cwd, cols, rows)` | New/reused bounded terminal session and replay |
| `pipilot:terminal:input` | `terminal.input(workspaceId, terminalId, data)` | Correlated bounded manual input acknowledgement |
| `pipilot:terminal:resize` | `terminal.resize(workspaceId, terminalId, cols, rows)` | Validated native PTY dimensions |
| `pipilot:terminal:kill` | `terminal.kill(workspaceId, terminalId)` | Awaited owned-terminal termination |
| `pipilot:terminal:event` | `terminal.subscribe(listener)` | Ordered bounded PTY data/truncation and exit event |

No raw `ipcRenderer`, child-process handle, PID, shell executable path, absolute
cwd, environment, canonical workspace root, or generic invoke/send was exposed.

## 7. New shared types

- `TerminalSession`
- `TerminalActionResult`
- `TerminalResizeResult`
- `TerminalEvent`
- terminal ID, columns, rows, input/output/replay, count, and dimension limits

## 8. New runtime schemas

- UUID terminal identity and active workspace identity;
- canonical workspace-relative cwd;
- 2-500 columns and 1-300 rows;
- 64 KiB input and data-event bounds;
- 1 MiB replay bound;
- strict created/reused terminal session with relative cwd and shell label;
- strict input/kill acknowledgement and resize result;
- discriminated ordered `data`/`exit` event with PTY stream/truncation state;
- strict create/input/resize/kill IPC request/response envelopes.

All Renderer, preload, and Main boundaries reject unknown or invalid fields.

## 9. Tests added

Unit coverage proves:

- canonical root/subdirectory cwd and no absolute path in public session data;
- traversal and external symlink cwd rejection;
- safe environment forwarding with Node/PiPilot/secret-shaped values removed;
- concurrent creates spawn exactly one native terminal and later creates reuse it;
- different cwd cannot silently replace a running workspace terminal;
- input, resize, output, exit, kill, workspace disposal, and global disposal;
- ordered replay/sequence consistency without duplicate pending output;
- output pause/backpressure, event bound, and explicit truncation;
- stale-workspace input is rejected before native write;
- the configured Unix shell on macOS/Linux and `ComSpec` on Windows;
- per-process terminal cap and fail-closed native start behavior;
- strict relative cwd, dimension, input, session, and event IPC schemas.

Electron E2E additionally proves:

- the sandbox bridge adds only the narrow `terminal` business API;
- a real Electron-ABI node-pty `/bin/sh` starts from the active workspace;
- existing bottom command entry and direct xterm keyboard input both reach PTY;
- both stdout and stderr content arrive through the merged PTY stream;
- native resize returns the exact requested rows/columns;
- a manual terminal file write succeeds without any permission event or
  ApprovalCard involvement;
- mono font, code size, ligature, word-wrap, and expanded-column changes apply
  to the mounted real terminal;
- switching workspaces emits old-terminal exit and the new PTY uses the new cwd;
- application quit sends HUP/TERM, triggers a shell cleanup trap, and leaves no
  owned PTY running.

## 10. Verification commands

- installed package declaration/source inspection for node-pty, xterm, addon-fit,
  electron-vite externalization, and Electron rebuild;
- official upstream/NPM documentation and stable-version verification;
- bundled offline pnpm 11.16.0 dependency add and lock update;
- bundled offline pnpm `rebuild node-pty`;
- bundled offline pnpm `run rebuild:native`;
- bundled offline pnpm `install --frozen-lockfile --offline`;
- bundled offline pnpm `exec tsc --noEmit`;
- focused and complete Vitest runs;
- bundled offline pnpm `run build`;
- focused and complete Playwright Electron runs;
- comparison-only Playwright visual suite;
- bundled offline pnpm `peers check`;
- `git diff --check` and focused secret/path, whitespace, generated-artifact,
  visual-baseline, staging, symlink, and Git-index hygiene checks.

## 11. Real result of each command

### Dependency and native module verification

- The first dependency add downloaded and locked the requested packages but
  exited non-zero because pnpm correctly blocked the new node-pty install script.
- `pnpm-workspace.yaml` now explicitly permits only `node-pty` in addition to
  the previously reviewed native/build packages; its install/postinstall then
  passed using the shipped macOS arm64 prebuild.
- `electron-rebuild -f -w node-pty` completed successfully against Electron
  43.3.0. node-gyp warned that the repository path contains a space, but emitted
  a valid arm64 Mach-O `build/Release/pty.node` and returned success.
- The Main build keeps `import("node-pty")` external instead of bundling a native
  binary into JavaScript.
- Frozen offline install reported the lockfile/node_modules state up to date and
  passed in 223 ms.
- `pnpm peers check`: no peer dependency issues.

### TypeScript, unit tests, and build

- Final TypeScript: `tsc --noEmit` passed.
- Focused terminal/IPC unit run: 2 files passed, 22 tests passed, 250 ms.
- Final unit suite: 12 files passed, 87 tests passed, 847 ms.
- Production build passed after its own typecheck.
- Main transformed 33 modules and emitted protocol chunk 18.35 kB, Agent Worker
  49.42 kB, and Main 173.71 kB.
- Preload transformed 88 modules and emitted 188.27 kB.
- Renderer transformed 733 modules. The initial bundle emitted HTML 1.56 kB,
  CSS 95.71 kB, and JavaScript 2,024.20 kB; lazy Terminal emitted separate CSS
  7.11 kB and JavaScript 568.98 kB chunks.

### Electron integration and visual regression

- Focused real-terminal E2E passed after two test-only corrections: selecting
  the visible command input instead of xterm's hidden textarea, and observing
  permission events instead of requiring an active Agent session for a pending
  snapshot. The final focused run passed in 4.6 s.
- Final Electron E2E: 7 passed, 0 failed, 25.0 s.
- Final visual comparison: 8 passed, 0 failed, 13.5 s.
- No visual baseline was regenerated or modified.

### Repository checks

- `git diff --check` passed with no whitespace errors.
- Focused source/test whitespace scan found no trailing whitespace.
- Focused source/test scan found no real home/workspace path, API-key-shaped
  value, or private-key marker in the Phase 8 surface.
- `git diff --name-only -- tests/visual/__screenshots__` returned no changed
  baseline file.
- No new Playwright report/result artifact appeared. Existing tracked
  `.playwright-mcp` log/snapshot deletions remain untouched.
- The Git index contains no mode `120000` entry and the staged diff is empty.
- Machine-local `.agents/skills` symlinks and their tracked-file deletion noise
  remain unstaged and untouched.

## 12. UI files modified

- `src/components/inspector/RealTerminalPanel.tsx`
- `src/components/inspector/TerminalPanel.tsx`
- `src/components/inspector/InspectorPanel.tsx`
- both locale catalogs

No theme token, global CSS, three-column layout, tab geometry, typography scale,
spacing, radius, border, Markdown styling, card structure, or visual baseline
file was modified. The xterm package CSS loads only with the real Terminal chunk.

## 13. UI modification necessity

Phase 8 explicitly requires the frozen Terminal region to become a real PTY.
The browser fixture still renders the original `TerminalPanel` DOM. Electron
mode lazily replaces only the existing tab body with xterm, retains the same
scroll region and bottom input footprint, and uses the current design tokens and
settings. A no-workspace Electron terminal now disables the fake cursor/input.

本阶段只把真实 PTY、ANSI 输出、交互输入、resize、生命周期和现有外观设置接入原终端区域；未修改三栏布局、主题 Token、全局 CSS、字号体系、间距、圆角、边框、信息密度、Markdown 样式或卡片结构。

## 14. Visual regression result

Passed: all 8 approved macOS dark/light references. No baseline was regenerated
or modified.

## 15. Mock data still in use

- Browser preview and visual tests intentionally retain the approved static
  Terminal fixture.
- Electron Terminal is real only when an active workspace exists; no-workspace
  mode is disabled rather than silently falling back to mock behavior.
- Logs remain a static/empty Inspector surface pending resource/diagnostic work.
- Header model/provider/context usage and Provider settings remain Phase 9.
- Resource, Skills, extension, MCP, and diagnostic settings remain Phase 10.
- Electron E2E uses Pi's real session/runtime/tool implementations with its
  official faux model provider; the PTY itself is a real native `/bin/sh`.

## 16. Known issues

- PTY stdout and stderr cannot be separated after both attach to the same
  pseudoterminal; public events accurately label the combined stream as `pty`.
- One terminal is intentionally supported per workspace in the frozen single
  Terminal tab. The global defensive cap is four; multi-terminal tabs/splits are
  outside the frozen Phase 8 UI.
- Output is ephemeral Main/xterm memory only: 64 KiB per event, 1 MiB pending and
  replay, and 5,000 xterm scrollback rows. It is not persisted or logged.
- Manual terminal output is intentionally raw user-directed terminal data. Main
  removes inherited internal and secret-shaped variables, but user shell startup
  files and commands can deliberately print local data; PiPilot does not persist
  that stream.
- Disabled word wrap uses a minimum 120-column PTY rather than infinite lines;
  terminal applications may still change their own DEC auto-wrap mode.
- Ligature response depends on the selected font and xterm renderer capabilities.
- Default shell is platform/environment selected; a user-configurable shell and
  scrollback settings surface has not been added because the phase requires safe
  platform defaults and existing appearance settings only.
- Native execution was exercised only on the current macOS arm64 host. Windows
  and Linux shell selection is unit-tested, but their native artifacts, installers,
  and packaged-app behavior remain Phase 11/12 CI and packaging evidence.
- Packaging must keep node-pty external and unpack its native/helper files; that
  artifact configuration and smoke test remain Phase 12.
- Bare Corepack pnpm remains unusable without registry access in this sandbox;
  verification used the bundled pnpm executable and the exact lockfile.

## 17. Next phase plan

Phase 9 will make models, providers, and credentials real:

1. inspect installed Pi 0.84.0 ModelRuntime/provider/auth declarations and
   implementations before selecting version-specific APIs;
2. expose grouped non-secret model/provider/configured-auth metadata through
   strict Agent/Main/preload contracts;
3. connect per-session model and thinking selection with rollback on failure;
4. add Main-owned safeStorage credential create/update/delete/test operations,
   exposing only configured state and a masked suffix;
5. detect insecure Linux credential-storage fallback and surface an accurate
   warning without placing keys in Renderer, session files, config, or logs;
6. connect the existing frozen header/settings regions with bilingual state and
   verify restart persistence, invalid credentials, session isolation, no secret
   leakage, Electron workflow, and unchanged visual references.
