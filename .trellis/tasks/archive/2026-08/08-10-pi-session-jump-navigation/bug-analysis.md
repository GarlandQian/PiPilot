# First-click session activation race

## Symptom

After reopening PiPilot, the first click on a visible session could fail while
the second click succeeded.

## Root cause

The Renderer intentionally retained the previous session rows while publishing
catalog `loading`. At the same time, Main's startup/runtime refresh incremented
the catalog version and deleted the cache immediately. The visible row therefore
held an opaque selection token that Main had already revoked. The next catalog
result supplied a new token, which made the second click appear to fix the
problem.

This was a cross-layer capability-lifetime bug, not a Pi startup timing problem.
Refresh coalescing removed false refresh errors but did not repair the mismatch
between visible row lifetime and token lifetime.

## Fix

- Retain the previous cache while a newer version scans.
- Keep old pagination cursors version-bound and stale immediately.
- Reuse a selection token only for the same canonical file, device/inode,
  session header, cwd, selection mode, and session ID.
- Revalidate the current direct file before opening and allow append-only JSONL
  growth only when the immutable identity still matches.
- Keep one-shot recovery and deletion token consumption unchanged.

## Prevention

The Electron regression seeds a persisted project and observed Pi session root,
restarts with delayed Pi startup hydration, clicks the session once while
initialization is still active, and requires one exact `--session` launch plus
complete selected-session hydration with no global error dialog.

## Premature loading settlement

### Symptom

After the first-click capability fix, the selected session eventually loaded,
but the conversation and inspector could briefly show their empty states between
loading and the final hydrated content.

### Root cause

The renderer treated any runtime generation newer than the generation observed
at click time as evidence that the selected activation had started. During cold
startup, an unrelated project-default Pi generation could become ready first and
prematurely settle the opening waiter. The actual catalog replacement then
cleared `activeSessionId`, exposing the empty presentation until the selected
generation completed.

### Fix

- Keep opening pending until `sessionCatalog.open` returns Main's authoritative
  `{ scope, sessionId, generation }` for that opaque selection.
- After confirmation, accept only the exact returned generation and session ID,
  plus complete session/transcript hydration.
- Scope cleanup by operation identity so an older operation cannot settle a
  newer selection.
- Resolve the waiter and clear refs on App unmount/HMR without calling setState.

### Prevention

The cold-start Electron probe is installed before the single click and observes
the full transition. It requires both content regions to enter loading, rejects
any intermediate empty presentation, waits for the selected content, and proves
only one exact `--session` process was launched.
