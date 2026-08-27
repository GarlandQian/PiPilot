# Desktop Runtime Directory Structure

## Layout

```text
src/
  main/
    index.ts                 # invocation-aware GUI/MCP entry
    bootstrap.ts             # headless stdio versus lazy GUI branch
    gui-main.ts              # GUI composition and lifecycle
    ipc/                     # channel registration and contract adapters
    pi-host/                 # embedded bundled-SDK Host + Runtime pool/controller + RPC projection
    local-pi-management/     # bundled helper management (install/update/remove, models, retry)
    conversations/           # scope resolution, activation, official session catalog
    mcp/                     # optional pi-mcp-adapter configuration service
    external-control/        # inbound MCP bridge/inventory/operation/lifecycle
    models-config/           # models.json service: fingerprint, atomic write, apiKey redaction
    repositories/            # settings/workspace/navigation/catalog observations
    terminal/                # PTY service
    workspace/               # file and Git workspace operations
    windows/                 # BrowserWindow creation and state
    diagnostics/             # Main diagnostics
    security/                # app protocol, navigation, and session helpers
  preload/index.ts           # constructs the window.pipilot facade
  shared/                    # types, Zod schemas, API and IPC contracts
tests/
  unit/                      # service, repository, schema, reducer tests
  electron/                  # launched Electron scenarios
  packaged/                  # packaged application checks
```

## Placement

- Application composition belongs in `src/main/index.ts`; domain services stay
  in their subdirectory.
- IPC registration modules adapt shared contracts to Main services. Current
  examples are `register-local-pi-ipc.ts`, `register-conversation-ipc.ts`, and
  `register-workspace-ipc.ts`.
- Embedded Pi process ownership stays in `src/main/pi-host/`. The renderer
  never spawns Pi; Main imports the exact bundled
  `@earendil-works/pi-coding-agent` pin through the Host seam.
  `src/main/ipc/projection/` keeps the renderer-ready gate and the iterative
  `get_tree` projection.
- Scope cwd and official session activation stay in `src/main/conversations/`.
  Project paths and Pi session files never cross into the renderer.
- Inbound PiPilot MCP ownership stays in `src/main/external-control/`. It reuses
  the catalog and Runtime owner through Main-only APIs; do not place bridge
  credentials, canonical targets, or MCP transport logic in preload/Renderer.
- Types shared with preload or renderer belong in `src/shared/` rather than a
  Main-only module.
- Keep platform and E2E tests under the matching `tests/` folder.
