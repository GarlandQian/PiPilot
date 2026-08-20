# Implementation Plan

1. Recheck official electron-updater 26.x-compatible API and add dependency.
2. Add shared schemas/types and IPC contracts/tests.
3. Implement provider interface, disabled/manual/native adapters, and state
   service with timers/concurrency/disposal.
4. Implement Main IPC registration and preload/PiPilot API facade.
5. Refactor Main shutdown coordinator and integrate confirmed install.
6. Add renderer adapter/provider with stable subscription cleanup.
7. Add focused service/lifecycle/IPC tests and packaged target inspection.
8. Document the stable feed/metadata contract consumed by the release child.

Validation: focused Vitest, `pnpm typecheck`, `pnpm build`, focused Electron,
then packaged smoke because Main lifecycle and packaged target detection change.
