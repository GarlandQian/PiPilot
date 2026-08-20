# Implementation Notes

## Bounded MVP Delivered

The first release implementation is limited to a Main-owned runtime registry
and pool. It creates one official `LocalPiRuntimeHost` per runtime, assigns
opaque `runtimeId`/`taskId` values, and keeps the existing singleton host as the
selected-runtime compatibility path for the current catalog and renderer.

Delivered behavior:

- distinct explicit Pi session files can run concurrently;
- a session-file lease rejects a duplicate start before a second child is
  spawned;
- commands, RPC events, extension UI requests, and stop operations route by
  `runtimeId`;
- an optional `maxActive` guard queues starts and drains deterministically when
  a slot is released;
- `localShared` summaries expose same-cwd conflict risk without claiming file
  locking or merge safety;
- pool selection is presentation-only and individual runtime stop is isolated;
- app shutdown disposes every pool-owned child process.

The pool does not copy, parse, rewrite, or relocate Pi session files. All child
processes continue through the existing official `--mode rpc --approve`
transport and host lifecycle.

## Files Changed

- `src/main/local-pi/local-pi-runtime-pool.ts`
- `src/shared/local-pi-runtime-pool.ts`
- `src/shared/ipc/contracts.ts`
- `src/shared/pipilot-api.ts`
- `src/preload/index.ts`
- `src/main/ipc/register-local-pi-ipc.ts`
- `src/main/index.ts`
- `tests/unit/local-pi-runtime-pool.test.ts`

## Verification

- `pnpm typecheck` — passed.
- `pnpm vitest run tests/unit/local-pi-runtime-pool.test.ts tests/unit/ipc-contracts.test.ts` — passed, 27 tests.
- `pnpm vitest run tests/unit/local-pi-runtime-host.test.ts tests/unit/local-pi-rpc-renderer.test.ts` — passed, 27 tests.
- `pnpm build` — passed.
- `git diff --check` — passed for the task files.

## Explicitly Deferred

- Renderer session-row status/stop UI and the unified running-tasks surface.
  The preload/API contracts exist, but the current Command Center rows still
  present only the singleton foreground projection.
- Worktree creation, lifecycle badges, conflict checks, and Local/Worktree
  Handoff. `workspaceMode` is carried in pool DTOs, but no Git mutation or
  worktree manager was added.
- Official session activation/catalog integration for pool-created tasks. The
  existing catalog and `OfficialPiSessionActivationService` remain bound to
  the compatibility singleton until a task/session association design is
  implemented.
- Symlink canonicalization for runtime leases. Lease keys currently use
  normalized `resolve()` paths; a follow-up must use verified `realpath()` (and
  reject unsafe identities) before claiming canonical-path equivalence.

Additional out-of-scope items remain automatic runtime resume after app restart,
durable task/workspace persistence, and provider/OS capacity governance beyond
the optional local active-process guard.
