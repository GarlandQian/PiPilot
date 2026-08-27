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
- [x] Record the confirmed real-workflow trigger: official successful `write`
  results omit undefined `details`, the strict local projection rejected the
  result, and a single event-projection failure was promoted to Host-fatal.
- [x] Accept official omitted tool-result details and add the exact
  `tool_execution_end` projection regression.
- [x] Keep a malformed non-transport Runtime event scoped and observable while
  allowing subsequent valid events to continue.
- [x] Re-run the real macOS workflow and packaged verification against the
  corrected projection boundary.
- [x] Run Trellis quality verification and a break-loop review before release work.

The packaged regression now executes the official SDK `write` path with an
omitted `details` field, verifies the selected Session remains ready, and then
sends a following prompt. The existing isolated forced Host-failure scenario
continues to cover explicit fatal recovery separately.

## Phase 6 — Session markers and rich queue control

- [x] Project Main-owned Runtime lifecycle/outcome into Sidebar-safe status
  markers without exposing paths or treating duplicate Session IDs as unique.
- [x] Preserve Composer-owned queued text and image payloads through queue
  events, reconnect boundaries, and rich queue previews.
- [x] Add safe Follow-up → Steer promotion with exact public queue validation,
  order verification, rollback, and fail-closed handling for unknown queues.
- [x] Add localized accessible queue actions and image-only validation.
- [x] Verify focused unit tests, full unit suite, typecheck/build, and the real
  Electron rich text/image queue regression.
- [x] Drop stale Runtime event/UI envelopes safely during replacement, always
  return Host credit, and cover the race with a regression test.

## Phase 7 — Recover provider-invalid empty-text history

- [x] Add a pure Runtime message sanitizer that removes whitespace-only text
  blocks while preserving images and other valid content.
- [x] Register it as a hidden final inline Pi extension for both `message_end`
  and `context`, including after a caller-provided `extensionsOverride`.
- [x] Recover existing malformed Session context without opening or rewriting
  the user's Pi JSONL, and prevent new image-only messages from persisting an
  empty text block.
- [x] Cover image-only input, historical recovery, empty tool results,
  non-empty identity, empty custom context, and extension ordering.
- [x] Run the focused 16-test regression set, the 636-test full unit suite,
  typecheck/build, and `git diff --check`.

## Phase 8 — Add Files-tree references to Composer

- [x] Add a localized pointer and keyboard context menu to project file and
  directory rows without triggering preview or expansion.
- [x] Re-project Main-owned relative tree entries through the existing Composer
  candidate boundary and deliver scoped, one-shot insertion requests.
- [x] Reuse trusted atomic mentions, canonical-path deduplication, safe spacing,
  and exact Markdown serialization from the typed `@` flow.
- [x] Preserve unchanged active `@query` replacement across natural menu blur,
  while explicit Escape, edits, caret movement, and scope reset invalidate it.
- [x] Verify mouse, ContextMenu key, Shift+F10, focus return, duplicate stability,
  arbitrary-caret insertion, no-submit side effects, typecheck, build, and the
  focused Electron regression.

## Phase 9 — Recover stuck tools and truthful streaming tool values

- [x] Treat incomplete official `toolcall_delta` arguments and official tool
  result content as bounded plain text while preserving structured validation
  for completed argument values.
- [x] Dispatch SDK abort outside a pending streaming Runtime command tail and
  signal cancellation before filesystem work.
- [x] Bound abort to a five-second grace period; hard-reclaim a timed-out or
  already-crashed Host, then hydrate the exact captured Session without
  replaying the interrupted Prompt.
- [x] Allow only abort to cross the crashed Runtime gate and tolerate its fresh
  Runtime generation in Renderer; keep every ordinary command ready-only.
- [x] Cover malformed-display regression, queue preemption, crashed-Host abort
  recovery, same-file hydration, no replay, and a following successful Prompt.
- [x] Verify 683 unit tests, typecheck/build, the focused Electron crash/abort
  scenario, and the full macOS unpacked packaged workflow.
