# PiPilot Test Matrix

Status: current authority, verified against the `0.0.2` worktree on 2026-09-02.
This matrix records executable evidence and explicit platform limits; historical
phase counts live in the documents listed by [the documentation index](README.md).

## Commands

| Gate | Command | Current evidence |
| --- | --- | --- |
| Frozen dependency install | `CI=true pnpm install --frozen-lockfile` | Passed with the release lock and supply-chain policy verification |
| Type safety | `tsc --noEmit` | Passed after the final Main/bootstrap, renderer, contract, test, and docs changes |
| Production build | `electron-vite build` | Passed; emitted Main, preload, Renderer, Host utility, and management-helper entries |
| Full unit | `vitest run` | Passed 88 files / 704 tests, including native UDS bridge tests |
| Full integration | `playwright test --config=playwright.integration.config.ts` | Passed 2/2 |
| Full Electron | `playwright test --config=playwright.electron.config.ts` | Passed 19/19 in 2.2 minutes |
| Focused launcher/MCP/bootstrap/IPC | `vitest run tests/unit/external-control-launcher-service.test.ts tests/unit/external-control-mcp.test.ts tests/unit/main-bootstrap.test.ts tests/unit/external-control-ipc.test.ts tests/unit/external-control-settings-contracts.test.ts tests/unit/local-pi-ipc.test.ts` | Passed 6 files / 43 tests; native socket run required the local elevated test environment |
| External Control settings | `playwright test tests/electron/external-control-settings.electron.spec.ts` | Passed 1/1, including managed-only confirmed uninstall, exact clipboard JSON, light/dark, and compact 1100px checks |
| Existing Electron startup smoke | project Electron Playwright smoke | Passed 1/1 after lazy Main chunk path verification |
| Local packaged build | `CSC_IDENTITY_AUTO_DISCOVERY=false pnpm package:dir` | Passed on macOS arm64 with the pinned Electron 43.4.1 distribution and ad-hoc identity |
| Packaged MCP smoke | `playwright test tests/packaged/pipilot.packaged.spec.ts --grep "installed stable MCP command"` | Passed 1/1 against the locally packaged macOS arm64 app bundle |
| Full packaged application | `playwright test --config=playwright.packaged.config.ts` | Passed 2/2 against the final rebuilt `release/mac-arm64/PiPilot.app`; GUI/SDK workflow in 34.9s and stable headless MCP in 8.4s |
| Dependency security | `pnpm audit --prod` | Passed with no known production dependency vulnerabilities |

The complete repository scripts remain the release gates:

```bash
pnpm test:unit
pnpm test:integration
pnpm test:electron
pnpm test:packaged
```

Their underlying commands were run on this same worktree before publication. A
focused pass remains insufficient as a substitute for the complete gate.

## Unit Coverage

Vitest covers shared contracts and boundaries in `tests/unit/`, including:

- strict External Control descriptor, bridge, MCP, command, lifecycle,
  preference, audit, inventory, operation, IPC, NUL, and revision schemas;
- exact Host/Runtime IDs, generations, control leases/pins, LRU reclamation,
  background acquisition, operation acceptance/settlement attribution,
  queue/follow-up/steer ordering, runtime disappearance, transformed input,
  recover-mode UI isolation, and client disconnect cancellation;
- official Session catalog scope/header/path containment, bounded observation,
  opaque identity, stale cursor/selection revalidation, and inactive rows;
- Pi Host protocol, utility, runtime frontend, pool, command dispatcher,
  package adapters, composer provenance, and renderer presentation;
- preference persistence rollback, bounded audit rotation, sanitized errors,
  and validated IPC registration disposal.

Tests parse untrusted data with the owning shared Zod schema and assert bounded
DTOs rather than inspecting raw SDK/Electron objects.

## Electron Coverage

`tests/electron/pipilot.electron.spec.ts` is the primary full desktop suite. It
uses temporary user-data and Pi package/session fixtures, a real sandboxed
BrowserWindow/preload/Renderer, and the bundled official SDK utility process.
The suite covers startup, session activation, streaming, queue/follow-up/steer,
tool approval, files/diff, terminal, model/integration settings, locale/theme,
extension UI, and shutdown. The external-control-specific scenario in
`tests/electron/external-control-settings.electron.spec.ts` additionally proves:

- the feature is disabled by default and appears only inside Integrations;
- enabling/disabling follows `disabled | enabling | ready | disabling | error |
  unavailable` with revision-safe responses;
- configuration exposes only the strict portable server entry
  `{ command: "pipilot-mcp", args: [] }`, with no token, raw ID, descriptor,
  ASAR entry, absolute installation path, or environment override;
- only a receipt-proven managed launcher exposes the confirmed uninstall
  action; uninstall errors stay inline and do not disable External Control;
- authenticated client count and metadata-only recent rows are projected;
- English and Simplified Chinese light/dark layouts fit the supported 1100x680
  window, with `scrollWidth <= clientWidth` for the internal tab strip;
- reduced-motion screenshot capture waits for settled switch animations.

## MCP And Bridge Coverage

The bridge and stdio tests cover the four-byte framed protocol, strict hello/
ack authentication, protocol/instance/token rejection, request/result bounds,
duplicate IDs, in-flight limits, handshake timeout, authenticated-client count,
descriptor cleanup, post-listen rollback, and descriptor rotation. MCP tests
cover the exact six tool schemas, server version injection, stdout JSON-RPC
purity, bounded stderr failures, already-aborted waits, and unavailable mode.

The operation tests prove that `send_prompt` returns only a `received` receipt,
acceptance is tied to the authoritative Host boundary, idempotency conflicts do
not dispatch, exact Runtime/generation/session attribution is preserved, and a
settled event cannot be inferred from unrelated events. Prompt/follow-up/steer
queue and user-entry anchors are tested in acceptance order; ambiguous or
transformed attribution fails closed. Client disconnect cancels waits without
aborting accepted work.

## Packaged Application

`tests/packaged/pipilot.packaged.spec.ts` inspects the ASAR and launches the
actual packaged executable with isolated temporary user data. It verifies:

- production Main/preload/Renderer and required bundled Pi/native entries;
- absence of repository source, tests, docs, credentials, Pi data, and Trellis
  development roots from the application archive;
- secure Electron fuses, native PTY placement, version `0.0.2`, and a single
  GUI CDP page;
- the installed `pipilot-mcp` command launches the packaged entry headlessly,
  starts no second GUI, discovers `pipilot-conversations` version `0.0.2` and
  exactly six tools, keeps stdout protocol-only/stderr empty, and reports one
  authenticated client;
- descriptor/socket/directory owner-only permissions, disable cleanup, and
  re-enable rotation of token, endpoint, and instance ID;
- enabled GUI shutdown, bounded headless failure while stopped, automatic
  External Control readiness after launching the GUI again with the same user
  data, stable copied configuration, and a second endpoint/token/instance
  rotation across the real restart;
- disabled/stopped launch returns a bounded stderr error, no stdout, and exit
  code 1.
- the GUI workflow switches among six persisted Sessions for longer than the
  reported few-second failure window, keeps a delayed background turn alive,
  reactivates a Session after per-Host idle-cache pressure, and recovers from an
  isolated one-shot Host failure without losing later Session hydration.

The current local packaged MCP and GUI Session workflows passed on macOS arm64.
The forced-failure fixture proves packaged recovery but did not reproduce the
original user's first real-workflow trigger, which remains unknown. Windows x64,
Linux x64, macOS x64, installer artifacts, and native ACL/sandbox behavior are
release-runner/device evidence and remain unclaimed until those jobs execute.

## Security And Privacy

Security checks cover Renderer sandbox/no Node globals, strict sender and URL
validation, path traversal/symlink escape, child environment sanitization,
secret/path/credential redaction, extension default-off behavior, bounded
diagnostics/audit, safe IPC disposal, and local bridge authentication. External
Control never returns raw Session paths, capability tokens, transcript/history,
tool arguments/results, or arbitrary internal errors.

## Release Gate

The CI workflow runs frozen-lockfile install, typecheck, unit, build,
integration, and Electron suites on its native runner. The release workflow
adds macOS, Windows, and Linux package/manifest/checksum/smoke jobs and a final
assembly check. Native jobs must run before a platform or public-release claim;
local macOS arm64 evidence does not imply Windows/Linux success.
