# Fix macOS runtime session collapse

## Goal

Ensure PiPilot on macOS remains able to open and switch between sessions after
startup. A failure in one runtime or host must not make every session in the
application permanently inaccessible.

## Background

- The defect occurs within seconds of launching or using PiPilot; it is not a
  long-running resource-pressure issue.
- After the first error appears, all sessions become impossible to open.
- The affected build is the public PiPilot `0.0.1` release.
- Similar session-loading and host-lifecycle failures have occurred during the
  embedded Pi SDK / utility-process migration, so the investigation must trace
  the first failure rather than treating the later loading UI as the root
  cause.

## Requirements

- Capture the first authoritative macOS failure and identify its owning layer:
  renderer selection state, Main runtime orchestration, utility-process host,
  MessagePort transport, embedded Pi SDK runtime, or packaged resources.
- Reproduce the failure against the current worktree and, where relevant, the
  packaged macOS application without reading or mutating the developer's real
  Pi configuration or sessions.
- Fix the root cause so one runtime failure cannot poison unrelated session
  opens or switches.
- Retire a crashed project Host and create one fresh Host on the next explicit
  session-open or session-switch request. Concurrent requests for the same
  project must join the same recovery operation.
- Do not automatically replay an accepted prompt, tool call, mutation, queued
  command, or extension UI response after a Host crash.
- Ensure every session-open attempt reaches an observable terminal state:
  ready with the selected session, or a scoped actionable error. It must not
  spin forever or leave global runtime state unusable.
- Preserve currently executing sessions when another session is opened or
  inspected, consistent with the project runtime architecture.
- Keep diagnostics bounded and free of credentials, prompts, private paths,
  and session contents.
- Show retained Session runtimes in the Sidebar with an explicit running,
  completed, or failed marker. Duplicate official Pi session IDs must remain
  distinguishable by their opaque catalog selection token.
- Preserve the complete text and image payload for PiPilot-owned queued
  Follow-up/Steer messages. A queued Follow-up may be promoted to Steer only
  when every queue item is known and can be rebuilt without loss; unknown or
  reconnected queues must fail closed and remain executable.
- Delayed Host events and extension UI requests from replaced Runtimes must be
  harmless: they cannot reach the selected Session, create unhandled Promise
  rejections, or consume the bounded Host event credit indefinitely.
- Existing Sessions containing provider-invalid empty text blocks must remain
  usable without rewriting Pi-owned JSONL. New image-only messages must not
  persist the SDK-generated empty text block that caused the invalid history.

## Confirmed Evidence

- PiPilot owns one Utility Host per canonical project/projectless scope, and
  multiple Session runtimes in that scope share the Host.
- `ProjectHostPool` currently retains a crashed Host in its scope map.
  `getOrCreateHost()` rejects every later activation for that scope with
  `HOST_CRASHED`, so a single failure permanently blocks every Session in the
  project until the whole application restarts.
- The Utility currently normalizes a fatal runtime/projection error and then
  discards it before closing the MessagePort. Main therefore records only the
  later `PORT_CLOSED` or `HOST_EXITED` symptom.
- An isolated macOS Electron run using the locally installed package set and a
  temporary Pi directory remained ready through startup and one fake-provider
  prompt. Static plugin loading alone is not a confirmed trigger; the exact
  first real-workflow fault was not covered by that fixture.
- The installed public `0.0.1` build recorded `HOST_RUNTIME_FATAL` at
  `2026-08-22T16:19:15.122Z` and `2026-08-22T16:20:03.434Z`. The selected Pi
  Session persisted successful `write` tool results one millisecond before the
  first diagnostic and in the same millisecond as the second diagnostic after
  an explicit re-open.
- Pi `0.84.2`'s official `write` tool returns `details: undefined` on success.
  PiPilot's DTO copier omits undefined object fields, but
  `localPiToolResultSchema` required `details` to be present. Projecting the
  resulting official `tool_execution_end` therefore failed validation.
- `RuntimeManager.bindSessionEvents()` promoted that single presentation-event
  projection failure to the Host fatal listener. The Utility closed the
  project Host, Renderer received `crashed`, and workspace state cleared the
  active Session. Re-opening the Session repeated the same deterministic fault.
- Pi `0.84.2` constructs image-only prompts as an empty text block followed by
  the image. An OpenAI-compatible endpoint rejects that block with
  `text content is empty`; because Pi replays the persisted history, later
  non-empty prompts in the same Session fail at the old entry as well.

## Acceptance Criteria

- [x] A clean macOS launch can open a session, switch to another session, and
      return to the first session without an indefinite loading state.
- [x] Repeating session open/switch operations for longer than the reported
      few-second failure window does not make all sessions inaccessible.
- [x] A forced runtime/host failure is isolated: unaffected sessions remain
      openable, the failed scope first exposes a terminal state, and its next
      explicit Session open recovers through one fresh Host.
- [x] Two concurrent Session opens after the same Host crash create one
      replacement Host and both settle without a restart loop.
- [x] The original Utility failure code reaches Main before port-close/exit
      symptoms, while persisted diagnostics contain no paths, prompts,
      credentials, Session contents, or arbitrary error text.
- [x] No session row remains in a permanent loading state after success,
      failure, supersession, host exit, or transport disconnect.
- [x] Focused unit/integration tests cover the confirmed root cause and the
      cross-session failure mode.
- [x] A real macOS Electron run verifies the user-visible workflow on the
      current build; packaged verification is included if the defect depends
      on packaged resources or process launch behavior.
- [x] Provider context removes historical whitespace-only text blocks while
      preserving images and non-empty content, so a later prompt can continue
      the same Session without editing its JSONL.
- [x] Newly finalized image-only messages are persisted without an empty text
      block; empty standard-role content receives a stable non-empty fallback.

## Superseded verification update (2026-08-22)

- The isolated macOS Electron recovery scenario passes with a one-shot
  `PIPILOT_E2E_HOST_FAILURE_MARKER`; unit coverage proves first-failure
  preservation, same-scope single-flight recovery, failed-replacement
  termination, projectless recovery, and healthy cross-project isolation.
- The actual `release/mac-arm64/PiPilot.app` passed the packaged GUI workflow in
  31.0 seconds: it opened and switched across six persisted Sessions, kept a
  delayed background turn running, reactivated an idle Runtime after exceeding
  the per-Host idle cache, recovered after the isolated one-shot Host failure,
  and re-opened the original Session without a permanent spinner.
- This forced-failure fixture proves recovery behavior but did not reproduce the
  official `write` result projection path. The installed-build evidence above
  supersedes any conclusion that the original workflow was fixed.

## Verification update (2026-08-23)

- The exact official SDK `write` result path now passes in Electron and the
  packaged macOS app. Pi `details: undefined` is omitted by the DTO projection,
  the file is written, settlement arrives, the selected `sessionId` and
  `sessionFile` remain unchanged, and a following prompt succeeds.
- The packaged regression also continues to pass the existing LRU and explicit
  Host-fatal recovery workflow. Focused unit tests are 37/37, the full unit
  suite is 622/622, typecheck/build are clean, and `package:dir` produced
  `release/mac-arm64/PiPilot.app`.
- The Host now installs one hidden final Pi extension that sanitizes both
  finalized messages and every provider context. Focused sanitizer/Runtime
  tests are 16/16, the full unit suite is 636/636, and typecheck/build are
  clean; existing Pi Session files are not opened for mutation by this
  recovery path.

## Release verification update (2026-08-24)

- The final `0.0.1` candidate passed the frozen-lock install and all current
  local gates: typecheck/build, 83 unit files with 643 tests, 2 integration
  tests, and 16 Electron tests. The Composer atomic-mention select-all path was
  repeated five times after moving selection handling ahead of extension
  keymaps.
- The rebuilt unsigned macOS arm64 application passed both packaged workflows:
  the bundled Pi SDK Session durability/recovery scenario in 32.9 seconds and
  the copied headless MCP private-bridge scenario in 4.6 seconds.

## Out Of Scope

- General performance tuning unrelated to the first failure.
- Redesigning the Sidebar, transcript, or loading visuals unless required to
  expose the correct terminal state.
- Changing release versioning or publishing another release during diagnosis.
- Blanket compatibility patches for plugins that have not been proven to
  trigger the failure.
- Automatically replaying work that may already have produced side effects.
