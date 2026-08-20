# Desktop Runtime Quality Guidelines

## Change Review

- Trace changed operations through all affected runtime entries and adapters.
- Check startup/shutdown behavior when adding timers, processes, subscriptions,
  or native handles.
- Keep SDK version-specific calls consistent with installed package types and
  current upstream documentation.
- Preserve existing user changes and avoid editing `node_modules`.

## Verification Selection

| Change | First check |
| --- | --- |
| Shared type/schema | `pnpm typecheck` plus its focused unit test |
| Main service/repository | Matching test under `tests/unit/` |
| Main/preload/renderer flow | `pnpm test:electron` |
| Embedded Pi SDK/host protocol | pi-host protocol/runtime/projector tests, then Electron |
| Native module/build entry | `pnpm build` and relevant packaged check |
| Packaging configuration | targeted package command for the platform |
| External Control bridge/stdio | focused native socket tests; packaged command smoke for bootstrap/config changes |

Use the broader suite for shared or cross-module changes. Report real command
results; do not infer a package or launch result from typecheck alone.

Static files under `tests/fixtures/` are test source, even when they reproduce
an upstream package's `dist/` layout. They must be present in the Git index;
never rely on an ignored or merely local fixture. `pnpm test:unit` runs
`build/verify-test-fixtures.cjs` before Vitest and must fail when a fixture is
untracked, ignored, or deleted. Keep build-output ignore rules anchored to the
repository root when nested fixture directories use the same conventional
name.

Electron window-mode assertions must not assume that a fresh default-size
window is unmaximized on every runner. A runner whose work area is no larger
than the default bounds may legitimately report it as maximized. Compare IPC
state with the authoritative `BrowserWindow` state, or explicitly establish a
window mode before asserting a fixed value. Window persistence tests must also
derive requested bounds from the current work area and the application's
effective minimum size; do not create coordinates that only become valid after
startup normalization. When the minimum fills the work area, the window may
remain natively maximized even after `unmaximize()`; compare persisted and
restored state using the same `isMaximized()` plus `getNormalBounds()` snapshot
semantics as production. If establishing that state is a native no-op, no
move/resize event is guaranteed; persistence assertions must read after the
window close/explicit flush path instead of relying only on the debounce timer.
On restart, compare against `normalizeWindowBounds(savedBounds, workAreas)` plus
the saved maximized mode, because production normalizes persisted normal bounds
before creating and optionally maximizing the new window.

PiPilot is tray-resident. A normal BrowserWindow close hides the window and
must not run application cleanup, dispose utility Hosts, stop Terminals, or
abort active Pi work. The tray Show action restores/focuses the existing
window; only the explicit tray Quit action, OS application quit, or update
installation enters `ApplicationShutdownCoordinator` and permits the native
window close after bounded cleanup. Electron lifecycle tests should start a
delayed real SDK prompt, close the window, prove the BrowserWindow is hidden
rather than destroyed, wait for the prompt to settle, then restore the same
window and observe its result.

Playwright `click()` waits for the DOM action, not an asynchronous React handler
or Main-process operation to settle. Before issuing a dependent follow-up IPC
operation, wait for an authoritative completed UI state and, when relevant, the
new runtime generation to report ready. A filesystem write that occurs before
restart is not proof that the restart has completed.

Native release checks must run on each target OS and normalize platform path
syntax before inspecting ASAR entries. Windows packaged fixtures use a `.cmd`
launcher; Unix fixtures use an executable shell launcher. Linux DEB metadata
must provide an explicit public maintainer address. macOS may generate
`latest-mac.yml` during packaging, but the ad-hoc/manual-download candidate
removes it before manifest generation and never uploads it.

The unsigned/ad-hoc macOS distribution must configure Chromium's
`use-mock-keychain` switch before any session is created. An ad-hoc application
can acquire a different code identity after each rebuild, so using the system
Keychain for Chromium browser-profile encryption causes recurring blocking
**PiPilot Safe Storage** prompts. This exception is allowed only while PiPilot
does not use Chromium cookies/password storage for application credentials.
Introducing Developer ID signing/notarization must remove the switch and prove
the stable signed identity can access browser data without repeated prompts.

Electron and packaged Pi tests must execute the bundled SDK through the real
utility-process host. Give every test an isolated `PI_CODING_AGENT_DIR` with
only the models, sessions, packages, extensions, Skills, and settings required
by that scenario. Never fall back to the developer's real `~/.pi/agent`, local
Pi executable, authentication state, model catalog, or package configuration.
Unexpected real models, extensions, UI surfaces, or credential prompts are
test-isolation failures rather than acceptable environmental variation.

Exercise the full user boundary with official v3 session files: a populated
project's persistent New session action, first-click session hydration, a
usable Composer, and Integrations package/resources. A mock transport, CLI
version probe, or utility-host handshake alone is not proof of those outcomes.

Packaged tests that launch child runtimes must close the real application
window and wait for the application's bounded shutdown before deleting a
temporary workspace. Do not disconnect CDP and immediately kill Electron: on
Windows an orphaned child whose current working directory is the workspace can
make cleanup fail with `EBUSY`. Forced termination requires a second bounded
exit wait, and recursive removal may use only a bounded retry for transient
Windows file locks; persistent leaks remain test failures.

On Ubuntu runners, packaged smoke must keep Chromium sandboxing enabled. Before
launching `release/linux-unpacked`, require `chrome-sandbox`, assign it
`root:root` ownership and mode `4755`, and verify the resulting metadata. Never
use `--no-sandbox` to make a native release gate pass. This runner-only setup
must not mutate the AppImage or DEB candidate after manifest generation.

Release architecture validation compares canonical architecture identities,
not one filename spelling. Treat `x64`, `x86_64`, and `amd64` as the same x64
identity, and `arm64`/`aarch64` as the same arm64 identity, while preserving the
exact per-platform artifact filenames in manifests and checksums.

Updater metadata validation must match the native platform's complete package
set. Windows `latest.yml` contains one NSIS EXE plus its external blockmap.
Linux `latest-linux.yml` contains both the AppImage and DEB; validate both
entries' size/SHA-512 and require the legacy `path`/`sha512` fields to match the
primary AppImage. Do not collapse Linux metadata to a single package.

External Control package evidence must launch the exact copied packaged command,
not a development Node entry or `open -a`. Assert no second GUI page, MCP
serverInfo equals `app.getVersion()`, exactly six tools, protocol-only stdout,
bounded stderr/nonzero disabled exit, authenticated client count, descriptor/
endpoint permissions, and endpoint/token/instance rotation. A macOS UDS pass is
not Windows named-pipe ACL evidence; unsupported native proof remains explicit.

## Existing Examples

- `tests/unit/workspace-content-service.test.ts`
- `tests/unit/terminal-service.test.ts`
- `tests/unit/pi-host-runtime-manager.test.ts`
- `tests/unit/official-pi-session-catalog.test.ts`
- `tests/electron/pipilot.electron.spec.ts`
- `tests/packaged/pipilot.packaged.spec.ts`

## Avoid

- Adding a new test framework for one small change.
- Removing a failing test to make a task pass.
- Treating a mock-only result as proof of a desktop or packaged workflow.
- Running every packaging target for a documentation-only change.
