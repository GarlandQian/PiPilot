# Dependency upgrade inventory

> **Post-implementation note (2026-08-22):** This file remains the dated
> pre-change registry inventory. The selected worktree retained the successful
> electron-vite `6.0.0-beta.1` / Vite `8.2.2` /
> `@vitejs/plugin-react@6.1.0` lane; Vite 7 was only the fallback. Current
> versions are authoritative in `package.json`, `pnpm-lock.yaml`, and
> `docs/ARCHITECTURE.md`. A release-gate registry rerun on 2026-08-22 returned
> `{}` from `pnpm outdated --json`. `pnpm audit --json` initially found the
> dev-only `GHSA-2v37-7h3g-55p8` through Vite/PostCSS's shared
> `nanoid@3.3.17`; the workspace now applies the narrow
> `nanoid@3.3.17 -> 3.3.18` override, the frozen lock resolves `3.3.18`, and the
> repeated audit reports zero vulnerabilities.

## Evidence date and sources

- Checked: 2026-08-21
- Source: authoritative npm registry metadata through `npm view` and
  `pnpm outdated`; current pins from `package.json` and `pnpm-lock.yaml`.
- The tables below preserve planning evidence. The post-implementation note
  above records the final registry and security resolution.

## Pi ecosystem

| Surface | Current | Registry latest | Ownership | Planning result |
| --- | ---: | ---: | --- | --- |
| `@earendil-works/pi-coding-agent` | 0.84.2 | 0.84.2 | bundled | Already latest; rerun parity/package gates. |
| `pi-mcp-adapter` | unpinned managed source | 2.27.0 | automatic global | Keep ownership; validate latest through the managed install path. |
| `pi-subagents` | user-selected | 0.53.0 | user-managed | Do not auto-install; validate generic/special adapter against latest. |
| `@narumitw/pi-plan-mode` | exact adapter 0.49.3 | 0.50.1 | user-managed | Update exact rich-adapter gate after surface verification. |
| `@narumitw/pi-goal` | exact adapter 0.52.1 | 0.52.2 | user-managed | Update exact rich-adapter gate after surface verification. |

## Outdated direct application/tooling dependencies

| Surface | Current | Registry latest | Compatibility note |
| --- | ---: | ---: | --- |
| Electron | 43.3.0 | 43.4.1 | Patch update; repeat Utility Process and packaged gates. |
| Tiptap family | 3.29.2 | 3.30.2 | Upgrade all six packages together; React 19 remains supported. |
| Vitest | 4.1.10 | 4.1.11 | Supports Vite 6/7/8. |
| react-resizable-panels | 4.12.2 | 4.12.3 | Patch update. |
| `@types/node` | 26.1.2 | 26.2.0 | Patch update. |
| Vite | 7.3.6 | 8.2.1 | Major migration; Node floor is satisfied. |
| `@vitejs/plugin-react` | 5.2.0 | 6.0.5 | Major; 6.0.5 requires Vite 8. |

## Vite/electron-vite conflict

- Stable `electron-vite@5.0.0` declares Vite `^5 || ^6 || ^7`, not Vite 8.
- `@vitejs/plugin-react@6.0.5` requires Vite 8.
- `electron-vite@6.0.0-beta.1` supports Vite `^6 || ^7 || ^8`, but is a beta.
- Repository historical evidence (`docs/PHASE_1_REPORT.md`) records an earlier
  Vite 8 peer conflict and deliberate rollback to the current stable Vite 7
  combination.
- Therefore absolute latest for Vite/plugin-react requires either accepting the
  electron-vite beta or replacing electron-vite with a custom Vite 8 build
  integration. Stable electron-vite cannot satisfy the absolute-latest set.
- Product decision: try `electron-vite@6.0.0-beta.1` with Vite 8 and
  `@vitejs/plugin-react@6` in an isolated migration lane. Keep that lane only
  when the complete current-worktree type, unit, Electron, build, package and
  packaged-smoke gates pass. If the lane introduces any gate failure that
  cannot be removed without weakening behavior or tests, revert the whole lane
  to the latest stable compatible `electron-vite@5 + Vite 7 + plugin-react 5`
  set and record the upstream blocker.

## MCP SDK

- The official current server package is `@modelcontextprotocol/server@2.0.0`
  with Node >=20.
- Registry exports were checked directly. The package exposes its server API at
  `.` and its stdio transport at `./stdio`; it does not require the deprecated
  monolithic SDK package.
- The official local integration is a stdio server. The packaged stdio entry
  must reserve stdout for JSON-RPC and log only to stderr.
- The stdio server is not the PiPilot control authority. It authenticates to a
  separate Main-owned Unix socket/named-pipe bridge and exposes bounded tools.
- On macOS the SDK owns only the client-facing stdio MCP protocol. The packaged
  PiPilot executable is launched directly in a headless mode and uses the
  current Node/Electron `net` Unix-domain-socket implementation to reach the
  already-running GUI Main. It does not use `open -a`, TCP, Keychain, or
  `safeStorage`, and the SDK does not own bridge authentication or lifecycle.
