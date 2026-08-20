# Implement — Windows packaged runtime acceptance fixes

Do not bump the version above `0.0.1`. Do not publish until every phase and the
native Windows gate pass. Preserve unrelated dirty work and never stage local
Skill symlinks or generated artifacts.

## Phase 1 — Missing project New session action

- [x] Add an always-present New session item to each available project's
      existing DropdownMenu in `SessionList.tsx`, routed through the existing
      `onStartProjectTask(projectId)` callback.
- [x] Keep the ready-empty inline Start task shortcut and top current-scope
      shortcut; all project routes converge on `workspace.newSession`.
- [x] Add matching en-US/zh-CN locale copy and retain current PiPilot spacing,
      icons, focus, hover, disabled, and menu behavior.
- [x] Update the focused Electron flow so a project with existing sessions can
      create a new project session from its menu.

## Phase 2 — Project creation wiring and existing-session hydration

- [x] Trace the new menu action through `workspace.newSession` and preserve the
      current Main distinction between a fresh cross-scope Pi Session and an
      in-place official `new_session`; do not add a redundant blank Session.
- [x] Preserve confirmation, serialization, scope disposal, publish-after-
      success, catalog observation, and exact returned identity.
- [x] Audit `App` opening handles, workspace activation, PiRpc hydration, and
      presentation gating for first-click existing-session activation.
- [x] Fix only confirmed early settlement, stale request, or terminal-error
      paths; do not add a second session state owner.
- [x] Update focused Main and renderer tests plus an Electron loading→ready
      assertion that proves persisted `get_messages` content appears on the
      first click with no empty/stale frame.

## Phase 3 — Windows npm/fnm runtime and package binding

- [x] Extract one bounded npm-command-shim classifier/resolver for Main use;
      do not maintain independent spawn and package-locator guesses.
- [x] Update `local-pi-spawn.ts` so a proven fnm/global npm shim receives the
      correct second escaping layer for version, RPC, session, and fork args
      without `shell: true`.
- [x] Add a native Windows argv trace using spaces, parentheses, and `&`; keep
      pure invocation-string tests only as a supplemental unit gate.

- [x] Refactor `local-pi-package-locator.ts` so direct-bin and Windows-shim
      candidates share one exact manifest/bin/export validator.
- [x] Add a bounded, fail-closed parser/resolver for the official npm-generated
      `.cmd`/`.bat` shape and derive only its exact relative target/package root.
- [x] Preserve runtime launch through the original shim; pass only the validated
      module entry/package root to the isolated management helper.
- [x] Add focused locator regressions for valid fnm/npm topology and every
      rejection class in the design.
- [x] Update the package-management task/spec language that currently rejects
      all wrappers, distinguishing provable npm shims from arbitrary wrappers.

## Phase 4 — Cross-layer and native validation

- [x] Run the smallest focused unit tests for conversation context, package
      locator, hydration/presentation, IPC contracts if touched, and fixtures.
- [x] Run `pnpm typecheck` and `pnpm build` after the edit batch.
- [x] Run the affected Electron scenarios against the fresh build and inspect
      loading, ready, error, dark/light, focus, and 1100×680 behavior for the
      changed Sidebar/session surface.
- [x] Extend the packaged fixture without touching real user Pi/session/config
      data. Reproduce an fnm-shaped installation, real npm batch grammar, exact
      argv trace, and importable fake Pi package. Verify fixture source is
      checked in and no test artifacts enter the package.
- [x] Run the Windows native package/smoke job and retain its exact successful
      evidence. macOS/local success cannot substitute for this gate.
- [x] Apply `trellis-break-loop`: update the owning backend/frontend quality
      specs so future release gates reproduce package-manager and first-click
      session acceptance rather than only process startup.
- [x] Run the task checker manifest, `git diff --check`, credential/host-path/
      package inventory audits, and report actual commands/results.

## Phase 5 — Replace the first public release (primary session only)

- [x] Confirm `package.json`, lockfile/application metadata, release scripts,
      and docs still identify `0.0.1`.
- [x] Audit tracked/untracked/deleted files and exclude generated/personal/secret
      content. Do not commit machine-specific Skill symlinks.
- [ ] Construct one reviewed root commit from the final tree without destructive
      reset of user files.
- [ ] Re-read remote `main`, tag, Release, and Actions state; use exact leases
      for force updates and fail if remote state changed unexpectedly.
- [ ] Force-update `main`, recreate annotated `v0.0.1`, trigger the release
      workflow, observe every native job, and verify the public Release asset
      inventory/checksums.
- [ ] Delete superseded/failed workflow runs so only the successful replacement
      release run remains visible. Verify remote main has one commit and tag
      peels to it.

## Risky Seams And Rollback Points

- Sidebar: reuse the existing callback; do not create a second new-session API.
- Conversation context: preserve the reviewed cross-scope/in-place distinction.
  If confirmation is not exact, stop before publishing activation.
- Hydration: never weaken identity checks to make the spinner disappear.
- Shim parser: false positive is worse than management unavailable; reject
  unknown grammar and keep normal chat working.
- Spawn escaping: source-string inspection is not proof; native child-observed
  argv owns acceptance.
- Release: all GitHub/Git mutations happen last, serially, and with freshly read
  exact targets. Any failed native gate stops before publication.

## Planned Validation Commands

```bash
pnpm exec vitest run \
  tests/unit/conversation-context-service.test.ts \
  tests/unit/local-pi-executable.test.ts \
  tests/unit/local-pi-package-locator.test.ts \
  tests/unit/local-pi-rpc-renderer.test.ts
pnpm typecheck
pnpm build
pnpm exec playwright test --config=playwright.electron.config.ts \
  tests/electron/pipilot.electron.spec.ts
pnpm test:unit
git diff --check
```

Native Windows package/smoke runs through the release workflow/configured
Windows runner; its exact command and run URL are recorded only after execution.

## Local validation evidence — 2026-08-14

- `pnpm exec vitest run tests/unit/conversation-context-service.test.ts tests/unit/local-pi-executable.test.ts tests/unit/local-pi-package-locator.test.ts tests/unit/local-pi-rpc-renderer.test.ts` — 4 files, 54 tests passed.
- `pnpm test:unit` — 53 files, 388 tests passed.
- `pnpm typecheck` — passed.
- `pnpm build` — passed.
- Focused Electron project-session scenarios — 2 tests passed.
- `pnpm test:electron` — 10 tests passed.
- `pnpm test:integration` — 2 tests passed.
- `pnpm package:dir` and `pnpm test:packaged` — passed on macOS.
- Fixture inventory, locale parity, task manifests, diff checks, credential scan, and host-path scan — passed.
- Native `windows-2025` package/smoke — passed in GitHub Actions dry-run
  `31768214892`: https://github.com/GarlandQian/PiPilot/actions/runs/31768214892
  (`Package windows` job `94668901222`, including packaged smoke).
