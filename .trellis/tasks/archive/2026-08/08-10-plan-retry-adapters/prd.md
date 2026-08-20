# Plan and retry adapters

## Goal

Add capability-gated rich Plan Mode and Retry UI using only externally reachable official Pi RPC and matching public local-Pi settings APIs.

## Parent And Dependencies

- Parent: `08-10-mcp-session-runtime-ux`.
- Requires `08-10-composer-extension-ux` to publish the generic activity/tool
  host contract.
- Requires `08-10-local-pi-integrations-manager` to publish exact package
  version/capability facts and matching public Retry settings operations.
- Must not start until both contracts are stable.

## Requirements

### Adapter boundary

- Register package-specific adapters only for Plan Mode and Retry.
- Activate only after exact package/version plus structured public capability
  validation. Package presence alone is insufficient.
- Key state by conversation scope, official session ID, and runtime generation;
  clear it on no-session, replacement, settlement where appropriate, or stale
  capability data.
- Unsupported/malformed versions and unknown states use generic official Pi
  tool/status/widget/message rendering.
- Never import plugin-private runtime objects, read private state files, parse
  notification prose, or add a bridge extension.

### Plan Mode

- Project bounded Markdown from versioned `plan_mode_complete` tool details and
  supported `proposed-plan` custom messages.
- Show planning/ready/saved/implementing state from exact supported status and
  structured message surfaces.
- Offer only actions backed by validated direct `/plan` routes or the existing
  official extension UI dialog protocol, such as Show, Finalize, Implement,
  Save, Export, Revise through a normal plan turn, and Exit when applicable.
- Preserve generic tool/message/status presentation when no supported adapter
  capability exists.

### Retry and pi-retry

- Pi's official retry engine solely owns attempts, budgets, delays,
  continuation, and cancellation. Do not implement a second retry loop.
- Replace simultaneous blind Enable/Disable actions with one authoritative
  global persisted value read/written through the matching public Pi
  `SettingsManager`, followed by official `set_auto_retry` synchronization for
  a ready process. Pi 0.84.1 does not expose a project-scoped retry-enabled
  setter, so the UI must not present this write as project-local.
- Show the global persisted enabled value separately from the current scope's
  effective enabled/maxRetries/baseDelayMs. A project override may make the
  effective value differ from the persisted global value; partial
  persistence/runtime synchronization failure must be explicit.
- Render official `auto_retry_start`/`auto_retry_end` as a compact Composer
  activity block with attempt/max, display-only countdown, bounded reason,
  Stop during a cancellable delay, recovered state, and final failure.
- Keep summarization retry separate.
- When exact supported `@narumitw/pi-retry@0.31.0` status values are observed,
  `receiving`/`retrying` may enrich the same block. Unknown values remain
  generic; do not parse injected error or notification text.

## Acceptance Criteria

- [x] Only Plan and Retry adapter registrations exist; Subagents and all other
      evaluated plugins remain generic.
- [x] A supported Plan Mode completion renders bounded Markdown and exact
      lifecycle state, and validated public actions work through official RPC.
- [x] Unsupported Plan versions/details/statuses remain readable generically
      and expose no rich controls.
- [x] Retry Settings distinguishes the authoritative global persisted value
      from the current scope's effective official value/defaults and
      synchronizes a ready runtime without claiming a project-scoped write.
- [x] Persistence success/runtime failure and persistence failure are distinct
      visible states.
- [x] Official retry events show attempt/max/countdown/reason/Stop/recovered/
      final failure without a second scheduler; summarization is labeled
      separately.
- [x] Supported pi-retry status enrichment works only for exact values/version;
      ordinary Pi retry works without the extension.
- [x] Session/generation replacement prevents late Plan/Retry state from
      reappearing.
- [x] Focused projector/adapter/settings tests, typecheck, build, and Plan/Retry
      Electron workflows pass.

## Out Of Scope

- Subagents, Goal, Rewind, Observational Memory, Hermes Memory, BTW, or Worktree
  rich adapters.
- Plugin source modifications or a PiPilot bridge extension.
- Private session-entry/state-file parsing.
- Editing Retry limits for which Pi exposes no public setter.
- Replacing Pi's official retry scheduler.
