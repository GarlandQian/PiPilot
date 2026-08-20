# Implementation Plan

## 1. Inventory Credential Ownership

- Find every credential value/type, Worker payload, Main repository/crypto
  composition, IPC/preload API, renderer store/component, mock, locale, test,
  dependency, and active documentation claim.
- Separate official RPC model/error presentation from PiPilot credential state.

## 2. Remove Product And Cross-Layer Contracts

- Delete credential Settings/routes/forms/test controls and renderer state.
- Remove credential operations and value fields from shared schemas, preload,
  Main handlers, legacy Worker payloads, fixtures, and model overrides.
- Update active copy to refer only to official local Pi configuration where
  guidance is necessary.

## 3. Delete Persistence And Cryptography

- Delete the credential repository, encryption helpers, `safeStorage`/Keychain
  initialization, and code that reads/decrypts/injects legacy values.
- Remove only dependencies proven unused after the repository-wide inventory and
  preserve `pnpm-lock.yaml` through pnpm.

## 4. Verify The Slice

After all related edits:

```bash
pnpm test:unit -- tests/unit/ipc-contracts.test.ts tests/unit/local-pi-runtime-host.test.ts
pnpm typecheck
pnpm build
```

Confirm repository-wide structural absence of PiPilot credential persistence and
that official model/error flow still works. Do not inspect external credential
files or claim official authentication was configured unless a local Pi smoke
actually proves it.

## File Ownership And Pre-Start Gate

This child owns credential-specific backend/shared/preload/renderer files,
locales/docs/tests, and uniquely unused dependencies. Renderer must already use
local RPC, no other child may rely on credential IPC, and context manifests must
validate before start.
