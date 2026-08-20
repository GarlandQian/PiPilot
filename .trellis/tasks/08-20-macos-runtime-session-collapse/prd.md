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
  first real-workflow fault still needs safe diagnostic capture.

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

## Verification update (2026-08-22)

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
  original user's first real-workflow trigger. That trigger remains unknown and
  must not be attributed to a plugin, provider, or packaged resource without a
  captured authoritative failure code.

## Out Of Scope

- General performance tuning unrelated to the first failure.
- Redesigning the Sidebar, transcript, or loading visuals unless required to
  expose the correct terminal state.
- Changing release versioning or publishing another release during diagnosis.
- Blanket compatibility patches for plugins that have not been proven to
  trigger the failure.
- Automatically replaying work that may already have produced side effects.
