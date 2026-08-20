# Verification Design

## Gate Order

1. Validate Trellis contexts and inspect dirty-worktree ownership.
2. Recheck registry/local versions, lockfile, dependency graph, and structural
   delete/retain inventory.
3. Run focused unit/contract tests.
4. Run typecheck and the complete unit suite.
5. Run relevant integration, Electron, and visually inspected UI checks.
6. Build and create a directory package.
7. Launch the packaged app with an explicit local Pi path and stripped
   version-manager PATH; exercise handshake/workflow/shutdown.

A failure returns to the owning child. Rerun the failed focused check first,
then broader gates whose inputs changed.

## Version And Dependency Gate

- Query the authoritative registry for latest Pi immediately before execution
  and record date/version.
- Probe the selected executable's canonical path and `--version`, then require
  documented `get_state`/`get_commands` capability success.
- Verify `package.json`, lockfile, built output, and production imports do not
  include direct `@earendil-works/pi-ai`,
  `@earendil-works/pi-coding-agent`, PiServer/PiClient/RemoteSession, or private
  upstream paths.
- Run frozen installation through pnpm; never edit `node_modules`.

## Structural Gate

Review repository searches for:

- old Worker entry, Main semantic supervisor, custom Agent protocol/transcript
  reducer, and embedded Pi service/client imports;
- credential repository/crypto/`safeStorage`, permission/approval, model safety,
  custom resource/MCP risk and enablement state;
- session delete/pin, Diff accept/revert/fingerprint, sensitive path/environment
  policy, and obsolete IPC/preload/actions;
- current documentation/package copy that promises removed behavior.
- standalone web scripts/config, production mock imports, web Store/adapter modes,
  browser visual server/flags, localStorage Settings authority, and hard-coded Pi
  runtime/About fallbacks.

Then reconcile every survivor against the official-first audit: Agent behavior
requires a current official contract; custom code requires a desktop-only reason.
An unclassified survivor fails the gate.

Separately prove retained matches for local RPC host/contracts, current session
catalog, rename/fork/clone, entries/tree inspection, compact/automatic-retry
controls, running Queue/Steer/Stop, queue events/count/modes, commands/stats/bash,
extension UI, and desktop workspace features.

## Focused Matrix

| Area | Required evidence |
| --- | --- |
| Executable | explicit/discovered path, version/capability state, no bundled fallback |
| JSONL | split/multiple/CRLF records, U+2028/U+2029, malformed/oversized input, IDs, backpressure |
| Lifecycle | timeout/cancel, stderr, crash, restart, old-generation rejection, workspace/session replacement, shutdown |
| Sessions | project/projectless cwd, omitted session-dir override, official effective-directory observation, bounded catalog/open |
| Renderer | snapshot replacement, delta assembly, tools/retry/compact, every supported action |
| Running input | idle Prompt, default Queue, one-shot Steer, separate Stop, captured draft acceptance, extension command routing |
| Queue state | generation-scoped `queue_update` details, reconnect count-only truth, official modes, bounded read-only view, no custom item mutation/persistence |
| Models | real official catalog/current/thinking state, bounded picker, Composer/Settings parity, no mocks |
| Extension UI | correlated dialogs, cancel, keyed status/widget/title/editor, errors, TUI degradation |
| Settings | real General/AppSettings/Models/Terminal/MCP/About sources; removed placeholder sections |
| Platform | preload-required Electron bootstrap, no standalone web mode; Electron-only visual harness |
| Fresh state | no credential/permission/resource repositories or old-data cleanup hooks; only current schemas are accepted |
| Structure | no old semantics/policies/dependencies; retained desktop and RPC capabilities compile |

Use existing Vitest and Playwright infrastructure; new focused tests are
warranted for core process, persistence, and cross-module contracts. Do not add
a new framework.

## Real And Fixture Pi Scenarios

The deterministic executable fixture covers protocol edge cases without a
provider. A real selected local Pi smoke uses a disposable workspace and fixture
global/project extensions, then calls only state, models/levels, commands, stats,
and supported extension UI. It verifies controlled restart behavior and official
TUI-only degradation without sending a model prompt.

Core-only absence is exercised with an Agent directory that contains no
optional plugin. It must still connect and expose all built-in RPC functions.

## Electron And Packaged Workflow

The deterministic Electron workflow exercises session/action/UI behavior listed
in the PRD, including normal/narrow model picker, running Queue/Steer/Stop and
bounded queue states, and every retained Settings source/state. Visual snapshots
launch BrowserWindow with preload/Main and test-only fixtures; no Vite browser
`webServer` is involved. The packaged harness
writes an explicit Pi executable path into
normal app settings, launches with PATH that omits fnm/nvm/mise shims, selects a
workspace, completes handshake and at least one deterministic command/extension
interaction, replaces/restarts once, then closes and proves the owned child is
gone.

## Reporting

Record exact command lines, exit codes, registry/local versions, executable
path, OS/architecture, package target, and evidence for passed/failed/skipped
checks. Do not log credentials, session contents, config secrets, or extension
tool results beyond deterministic fixture text.
