# Runtime and session reliability

## Goal

Make deep official Pi RPC responses clone-safe, converge first-session catalog refreshes, and clear session-owned inspector data during no-session/loading states.

## Parent And Dependency

- Parent: `08-10-mcp-session-runtime-ux`.
- This child has no implementation dependency. Its shared response and
  readiness contracts must stabilize before the parent runs combined Electron
  verification.

## Requirements

### Clone-safe official RPC

- Preserve exact Pi 0.84.1 host validation, including iterative validation of
  deeply nested `get_tree` data and existing node/depth bounds.
- Do not return the recursive tree across Electron IPC. Main must project it to
  a bounded flat typed renderer DTO before resolving
  `pipilot:local-pi:command`.
- Clone/projection failures must become typed local-Pi errors rather than
  Electron `An object could not be cloned` handler failures.
- Other official command semantics and the renderer's history order, labels,
  leaf identity, and entry data must remain intact.

### Catalog convergence

- Preserve existing same-scope explicit refresh coalescing.
- Replace the remaining fixed two-attempt refresh with a bounded dirty-
  generation coordinator that absorbs normal activation invalidation bursts.
- A normal first-session activation that ultimately loads must not show the
  `session catalog changed during refresh` operation modal.
- Stale tokens/cursors, changed files, wrong scope, deleted sessions, and Pi
  activation failures remain visible typed errors.
- Superseded renderer refreshes must not report globally after a newer request
  wins.

### Session-owned inspector state

- Files, Changes, and Pi Session must not fetch or show previous data while no
  session is selected or the selected session is hydrating.
- Their empty/loading/error states are centered in the full inspector content
  region and never overlay stale rows.
- Session/workspace/runtime-generation changes invalidate all in-flight
  Files/Changes/Pi Session requests.
- Terminal remains available for an explicitly selected project because it is
  workspace-scoped.

## Acceptance Criteria

- [ ] A valid tree at least 1,762 levels deep crosses Main/preload/renderer in a
      real Electron workflow without stack overflow or structured-clone error.
- [ ] Flat tree projection preserves preorder, depth, parent, label, entry, and
      leaf semantics and enforces bounded nodes/depth.
- [ ] A realistic activation invalidation burst converges without a false
      global catalog error.
- [ ] A deliberately stale catalog selection still produces its typed error.
- [ ] No selected session shows centered empty content for Files, Changes, and
      Pi Session; selection shows centered loading until full hydration.
- [ ] Rapid session switching cannot restore late Files, Changes, or Pi Session
      data from the previous generation.
- [ ] Focused unit/IPC tests, typecheck, production build, and the filtered
      Electron regressions pass.

## Out Of Scope

- Changing official Pi session semantics or loosening response validation.
- Moving Terminal behind the session readiness gate.
- Hiding real catalog selection/path/identity/process failures.
- Plugin package management or rich adapter UI.
