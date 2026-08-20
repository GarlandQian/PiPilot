# Verify The Local Official Pi RPC Migration

## Goal

Run the final structural, behavioral, fresh-state, Electron, build, and packaged
gate after all cutover children converge, and report only evidence exercised
against the current worktree and selected local Pi executable.

## Requirements

- Recheck the official npm registry before execution and record the latest
  `@earendil-works/pi-coding-agent` version. Planning baseline is `0.84.1`,
  verified on 2026-08-08; the selected local Pi must be updated separately if it
  is not the latest version verified for implementation.
- Verify PiPilot has no direct Pi runtime SDK dependency and never falls back to
  `node_modules`, PiServer/PiClient/RemoteSession, private `dist/` imports, or the
  old Worker.
- Verify PiPilot is Electron-only: no standalone web scripts/runtime, production
  fixture imports, web-mode Store/adapter, or browser-server visual harness. A
  missing preload must stop before providers mount.
- Verify frozen lockfile installation and the absence of duplicate Agent runtime
  cohorts from the application dependency graph.
- Validate local executable discovery, explicit configuration, capability
  handshake, strict JSONL, process lifecycle, crash/restart, workspace/session
  replacement, and packaged launch without version-manager PATH.
- Verify Pi-owned session discovery/catalog, structural removal of
  credential/permission/resource persistence, official renderer
  snapshots/events/actions, installed plugin discovery, and extension UI
  handling. Do not inspect or mutate old external app data.
- Verify running input uses idle `prompt`, default `follow_up` Queue, one-shot
  `steer`, and separate `abort`; queue detail comes only from `queue_update`,
  reconnect state is count-only until another event, and official queue modes
  round-trip without custom item mutation or persistence.
- Verify each retained Settings section against its declared real source and the
  absence of Permissions/Agent Resources/Updates/disabled General/credential
  placeholders and hard-coded Pi runtime/About values.
- Verify all non-MCP core and desktop workflows with only local Pi installed;
  generic plugin absence must not disable them. MCP adapter-specific behavior is
  verified by the umbrella MCP sibling gate.
- Run focused tests first, then full shared/core checks because the cutover
  changes runtime, persistence, contracts, renderer state, build, and packaging.
- Exercise a real local no-model handshake and deterministic fake/fixture Pi
  paths; never require a paid provider request for the cutover gate.
- Record exact commands, selected executable/version, platform/architecture,
  pass/fail/not-run status, and limitations. Route failures to the owning child
  and never delete or weaken unrelated tests to obtain a pass.

## Acceptance Criteria

- [ ] Task contexts/manifests validate and `pnpm install --frozen-lockfile`
      succeeds without modifying third-party files.
- [ ] The report records the registry latest Pi version and the actual selected
      local executable path/version; the executable passes the documented
      capability handshake or the gate blocks with a clear prerequisite.
- [ ] Package/lock/build output contains no direct Pi Agent/AI SDK runtime,
      PiServer/PiClient/RemoteSession, private upstream path, or embedded Worker
      fallback.
- [ ] Focused strict-JSONL, host lifecycle, current session catalog, renderer,
      extension UI, and current-schema contract tests pass.
- [ ] A fixture global extension and project extension load through the selected
      Pi, expose commands/tools, use supported dialog/fire-and-forget UI, survive
      controlled restart, and show official errors/degraded TUI behavior.
- [ ] Electron passes new/open/switch, prompt/steer/follow-up, abort,
      model/thinking/modes, compact/automatic-retry controls, rename/fork/clone,
      entries/tree inspection, official bash, commands, stats, reconnect, and
      scope replacement through local RPC.
- [ ] Electron proves every running primary/keyboard submission defaults to
      Queue, explicit Steer applies once, Stop remains independent, official
      queue lists/counts/modes stay truthful across reconnect, extension-source
      commands run immediately, and no item edit/reorder/dequeue/cancel exists.
- [ ] Project/projectless launches use their exact cwd, omit `--session-dir`,
      learn catalog locations from official `sessionFile`, and never read,
      import, convert, or delete old PiPilot data or official Pi files.
- [ ] Structural review confirms removed session delete/pin,
      credential/resource/approval/model-safety/MCP-risk, sensitive-path/env
      policy, and Diff mutation paths are absent while supported RPC actions and
      retained desktop features remain.
- [ ] Structural review also confirms no `dev:web`/`build:web`, production
      `src/data/mock`, `'web'` Store/adapter mode, localStorage Settings authority,
      browser visual server, or hard-coded Pi runtime/About fallback remains.
- [ ] Electron Settings shows actual executable/probe/app/model/thinking/terminal/
      MCP data and truthful loading/empty/error states; every visible control has
      a real owner and no disabled fixture section remains.
- [ ] Full unit, relevant integration/Electron/visual, typecheck, production
      build, directory package, and packaged explicit-path startup pass.
- [ ] Packaged shutdown leaves no owned Pi child process, pending request,
      listener, timer, or dialog.
- [ ] Final report distinguishes passed, failed, skipped, and blocked checks; no
      unrun check is claimed as passing.

## Out Of Scope

- Automatically installing/updating global Pi or packages from PiPilot.
- Paid provider/model output as a required verification step.
- Release signing, notarization, publishing, or platforms not exercised.
- Restoring a removed feature to satisfy an obsolete test.
- Introducing a new test framework solely for this gate.
- Restoring standalone browser support or production sample data to satisfy old
  visual baselines.
- Staging, committing, or including machine-local skill symlinks.

## Dependencies And Ownership

This task follows runtime, session catalog, renderer, credential, embedded-stack
cleanup, terminal Settings, and MCP Settings. These cross-parent dependencies are
required because the gate verifies the final real-source Settings layout. It owns
final test orchestration, structural/dependency
queries, real/fake local Pi smoke, packaged explicit-path scenario, and results
record. Product fixes remain with the failing child; verification reruns only
affected checks before repeating broader gates.

## Risks And Deferred Items

- The user's Pi was `0.84.0` when planning began, so a latest-version real smoke
  may require an explicit external update before the gate can pass.
- Visual baselines can hide accidental removals; changes require inspection,
  not unconditional regeneration.
- Package build success alone does not prove desktop PATH discovery or child
  cleanup, so the packaged explicit-path scenario is mandatory.
