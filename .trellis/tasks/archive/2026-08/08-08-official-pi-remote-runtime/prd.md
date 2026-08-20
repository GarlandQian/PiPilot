# Host The Local Official Pi RPC Process

## Goal

Resolve and control the user's locally installed official Pi CLI in RPC mode,
replacing PiPilot's semantic Worker protocol with a minimal documented JSONL
process bridge that loads the user's real Pi packages and configuration.

## Requirements

- Add an optional absolute Pi executable setting. Resolve explicit setting,
  inherited PATH, login-shell discovery on macOS/Linux, and platform command
  discovery on Windows without installing or bundling Pi.
- Probe and display the canonical executable path and actual version. Develop
  and verify against the latest official Pi rechecked at implementation; reject
  missing, older, or unverified newer Pi with a recoverable setup state and
  stderr diagnostics. Add no version compatibility shim.
- Replace General/About Settings placeholders with real Main-owned data: the
  saved explicit path, discovered canonical path, probe state/version, bounded
  diagnostic, retry/select/reset actions, and `app.getVersion()` plus actual
  platform/architecture/Electron information. Never display the removed bundled
  SDK version constant as the selected Pi version.
- Spawn the executable in the resolved conversation cwd as
  `pi --mode rpc --approve`, plus an official `--session` path when opening an
  existing session. Never pass `--session-dir`.
  `--approve` is the official per-run project-resource trust override, not a
  PiPilot approval system.
- Preserve the host environment and the selected Pi installation's normal
  `PI_CODING_AGENT_DIR`, settings, auth, packages, extensions, skills, prompts,
  MCP adapter, and sessions. Do not inject PiPilot credentials/resources or use
  Agent-specific environment filtering.
- Implement strict LF-delimited UTF-8 JSONL: retain partial chunks, split only
  on byte LF, strip an optional trailing CR, parse complete records, serialize
  commands with LF, and never use generic line readers.
- Correlate documented responses by request ID, route official events and
  extension UI requests, bound stderr diagnostics, and expose connection status.
  Unknown envelopes remain visible protocol diagnostics.
- Own one process for the active scope/session with deterministic abort,
  pending-request rejection, restart, session/workspace replacement, renderer
  reload, window close, and app shutdown behavior.
- Retain only process generation and request correlation needed to reject output
  from a replaced child. Do not reproduce Agent epochs, transcripts, approvals,
  retries, or policy semantics in Main.
- Provide command methods for every official RPC command consumed by later
  children and subscriptions for official events/UI requests.
- Add no Pi SDK/server/client dependency. The bridge must not import private Pi
  paths or copy upstream `RpcClient` implementation.

## Acceptance Criteria

- [ ] An explicit local Pi path and discovered Pi path can be probed; the UI
      reports canonical path, version, ready/incompatible/missing state, and
      bounded stderr without exposing a bundled fallback.
- [ ] General/About Settings render only actual Main/runtime/app information;
      loading/missing/error states are explicit and neither a hard-coded Pi SDK
      version nor a browser-preview fallback is shown.
- [ ] The child launches with the active cwd and `--mode rpc --approve`, loads a
      global and project fixture extension, omits `--session-dir`, and returns
      their commands through `get_commands`.
- [ ] Strict framing handles split/multiple records, CRLF, U+2028/U+2029 inside
      JSON strings, malformed records, backpressure, and process exit.
- [ ] Each command resolves only its matching response, times out/cancels
      deterministically, and late output from an old generation is ignored.
- [ ] Official Agent events, extension UI requests, stderr, exit, restart,
      workspace replacement, and session replacement reach typed subscribers.
- [ ] Renderer remount and app shutdown leave no duplicate or orphaned process,
      listener, timer, or pending request.
- [ ] No production import uses Pi SDK runtime, PiServer/PiClient, a private
      `dist/` path, or the legacy semantic Worker as fallback.
- [ ] Focused transport/lifecycle tests, typecheck, build, and a packaged
      explicit-path no-model handshake pass.

## Out Of Scope

- Installing/updating Pi or any Pi package.
- Interpreting transcript semantics or maintaining renderer Agent state.
- Listing current sessions, which belongs to the session-catalog child.
- Rendering extension UI, which belongs to the renderer child.
- Supporting an undocumented Pi version by silently coercing envelopes.

## Dependency And Ownership

This is the first migration implementation child. It owns executable settings,
its real General/About presentation, discovery/probe, Main process/JSONL host,
typed transport contracts, preload
bridge, lifecycle diagnostics, fake executable fixture, and focused tests. The
session-catalog and renderer children consume its resolved process/session
contracts.

## Risks

- Desktop launches may not inherit fnm/nvm/mise PATH, so explicit configuration
  and host discovery must both be exercised in a packaged app.
- Local extensions can be TUI-only. The host reports official degraded behavior
  and extension errors rather than adding private protocol methods.
