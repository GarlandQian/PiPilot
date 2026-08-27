# Implementation

1. Replace the public External Control configuration schema with the strict
   `pipilot-mcp` empty-args entry and add bounded launcher snapshot/result
   schemas plus IPC contracts.
2. Implement the Main-owned launcher service with POSIX secure PATH discovery,
   marked atomic wrapper install/repair/removal, Linux AppImage target handling,
   and injected Windows user-PATH persistence and exact-entry rollback removal.
3. Update the packaged Windows CUI copy name and headless bootstrap so an empty
   public argument list resolves the descriptor internally.
4. Register launcher get/install/uninstall IPC, preload methods, renderer adapter/store
   state, and Main composition without coupling it to bridge enable/disable.
5. Update External Control UI and bilingual locales using existing compact
   primitives; add confirmed inline uninstall and render/copy the exact standard
   `mcpServers` JSON.
6. Update focused unit, Electron, packaged, release inventory, README,
   architecture, packaging, and authoritative Trellis specs to the new public
   contract.
7. Run focused tests, typecheck, unit suite, build, Electron External Control
   scenario, `package:dir`, and packaged MCP smoke. Run or dispatch native CI
   before claiming Windows/Linux success.

## Risky Files And Rollback Points

- `src/main/bootstrap.ts` and `src/main/external-control/mcp-stdio.ts`: stdout
  purity and Windows fd0 behavior must not regress.
- `build/apply-electron-fuses.cjs`: the Windows copy must retain CUI subsystem
  mutation and normal `resources/app.asar` loading.
- User PATH boundaries: never invoke a shell, overwrite an unrelated launcher,
  or drop unrelated PATH entries.
- `tests/packaged/pipilot.packaged.spec.ts`: launch the public empty-args
  command rather than a private shortcut.

## Validation Commands

```sh
pnpm typecheck
pnpm test:unit
pnpm build
pnpm test:electron --grep "External Control"
pnpm package:dir
pnpm test:packaged --grep "MCP command"
```
