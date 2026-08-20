# Implementation Plan

## 1. Build The Live Delete/Retain Inventory

- Start from the capability matrix and search production imports, schemas, IPC,
  preload, stores, UI, shortcuts, mocks, tests, build inputs, dependencies,
  locales, and active docs.
- Record an official-RPC replacement, retained desktop owner, or explicit
  deletion for every hit before removing files.

## 2. Delete Legacy Agent Semantics And Policies

- Delete the embedded Worker, semantic Main supervisor, custom Agent protocol,
  transcript projection/reducer, model-safety, permission/approval, custom
  resource/risk, and stale credential remnants.
- Remove old IPC/preload/routes/actions and unsupported session delete/pin while
  preserving every documented RPC-supported action and extension UI surface.

## 3. Remove Feature-Specific Safety And Mutation Code

- Remove Agent process environment scrubbing and workspace sensitive-path
  filtering.
- With the Diff sibling, delete accept/revert, patch records, mutation
  fingerprints/conflict APIs, and mutation-only filesystem logic.
- Retain canonical workspace containment, read bounds, RPC correlation, atomic
  surviving app writes, and bounded current Pi session catalog behavior.

## 4. Delete Obsolete Persistence Code

- Delete the `permissions.json` and `resource-preferences.json` repositories,
  path constants, schemas, startup wiring, tests, and claims.
- Confirm no translation into Pi settings, no replacement repository, and no
  old-data cleanup/import/compatibility hook.

## 5. Clean Build, Dependencies, Tests, And Claims

- Remove the old Worker build input and dead composition.
- Remove direct Pi runtime packages with pnpm after all imports disappear.
- Delete behavior-only tests; update broad tests/mocks/locales/current docs to
  local RPC and retained desktop capability.
- Delete standalone web scripts/config, web Store/adapter modes, production mock
  imports/static Inspector/App branches, and the localStorage Settings authority.
- Add the root preload requirement and migrate retained visual assertions to
  Electron with test-only fixtures.
- Finalize the real-source Settings navigation after runtime/renderer/terminal/
  MCP handoffs; remove placeholder sections, hard-coded Pi version/About fallback,
  credential/resource/permission/update UI, and stale copy.
- Preserve machine-local `.agents/skills/` symlink/deletion noise and unrelated
  dirty-worktree edits.

## 6. Run Structural And Build Checks

After all deletion groups:

```bash
rg -n "agent-runtime-supervisor|agent-protocol|model-safety|permission-gate|credential-repository|resource-catalog|safeStorage" src tests package.json electron.vite.config.ts
rg -n "session.*(delete|pin)|changes\.(accept|revert)|fingerprint|sensitivePath|createUnprivilegedProcessEnvironment" src tests
rg -n "mode:.*web|mode === 'web'|dev:web|build:web|LocalStorageSettingsAdapter|src/data/mock|@/data/mock|VITE_PIPILOT_VISUAL_TEST|PI_RUNTIME_VERSION|webPreview" src tests package.json playwright*.config.ts
pnpm test:unit -- tests/unit/local-pi-runtime-host.test.ts tests/unit/local-pi-rpc-renderer.test.ts
pnpm typecheck
pnpm test:visual
pnpm build
```

Review every structural match in context; unrelated desktop meanings are
documented. Record actual results.

## File Ownership And Pre-Start Gate

This child owns dead legacy Agent/backend/shared/preload/renderer code,
permission/resource persistence removal, removed safety/mutation surfaces, build and
direct Pi dependency cleanup, Electron-only/mock cleanup, final Settings layout,
and obsolete tests/current claims. Preserve the
new local-RPC host, renderer adapter, catalog, MCP standard-config
adapter, sibling desktop features, and all unrelated user changes. All cutover
children plus read-only Diff, terminal Settings, and MCP Settings handoffs must be
complete before the final layout/mock sweep; context manifests must validate
before start.
