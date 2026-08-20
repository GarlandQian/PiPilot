# Implementation plan — macOS Runtime Session collapse

## Phase 1 — Preserve the first Utility failure

- [x] Increment the bundled Host protocol version and add a strict, bounded
  host-failure envelope.
- [x] Classify fatal Utility call sites and best-effort send one sanitized failure
  before shutdown.
- [x] Teach `PiHostController` to preserve the first failure for a Host epoch and
  ignore later port-close/process-exit diagnostic replacement.
- [x] Connect safe Host lifecycle codes to `MainDiagnostics`; persist codes only.
- [x] Add protocol, Utility, and controller regressions for malformed, stale,
  duplicate, close-race, and path/secret-redaction cases.

## Phase 2 — Make crashed Host entries recoverable

- [x] Introduce an async per-scope Host acquisition/single-flight transition in
  `ProjectHostPool`.
- [x] Retire crashed entries identity-safely: detach listeners, clear Runtime
  ownership and leases, remove the exact map entry, and dispose the old
  controller best-effort.
- [x] Allocate and handshake one replacement Host on the next explicit Session
  activation; concurrent activations join it.
- [x] Return one typed terminal failure if replacement startup fails. Do not loop
  or replay accepted operations.
- [x] Cover same-project concurrent recovery, stale callbacks, failed replacement,
  projectless recovery, and healthy cross-project isolation.

## Phase 3 — Close the Runtime/Renderer terminal-state contract

- [x] Map Host start/recovery failures to a non-recoverable Runtime frontend error
  for the current activation, outside the generic one-retry race path.
- [x] Ensure a Host crash clears only Runtime caches owned by that Host and settles
  pending commands/UI for their exact generation.
- [x] Verify Session activation and workspace state keep loading until the exact
  replacement identity is ready or error; superseded operations cannot leave
  rows spinning or publish stale data.
- [x] Reuse existing centered loading and scoped error UI. Do not redesign the
  Sidebar or conversation surface.

## Phase 4 — Real macOS failure/recovery workflow

- [x] Extend the isolated SDK/Electron fixture with a one-shot Host-failure trigger
  backed by a temporary marker, never by the developer's real Pi directory.
- [x] Exercise Session A -> Session B -> forced Host failure -> one-click recovery
  -> Session A, plus a healthy Session in another project.
- [x] Repeat switching beyond the reported few-second failure window and assert
  every selection ends in ready or a scoped terminal error.
- [x] Run focused tests, full typecheck/unit/build, and the macOS Electron scenario.
  Run packaged smoke if production process/resource behavior differs.

## Phase 5 — Contract documentation and prevention

- [x] Update the embedded Host and official Renderer specs with the first-fault,
  demand-driven recovery, no-replay, and terminal-loading contracts.
- [ ] Record the confirmed trigger code from safe diagnostics if the real user
  workflow reproduces it; do not attribute the failure to a plugin/provider
  without evidence.
- [ ] Run Trellis quality verification and a break-loop review before release work.

The packaged regression above uses an isolated forced Host failure and is not
evidence that the original user trigger has been reproduced. The first real
trigger remains unknown.
