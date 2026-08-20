# Technical Design

## Process Boundary

```text
Renderer RPC adapter
  -> preload typed IPC
  -> Main LocalPiRuntimeHost
       - executable resolver and version/capability probe
       - child process generation/lifecycle
       - strict JSONL parser/writer
       - request map and event/UI subscriptions
       - bounded stderr diagnostics
  -> local pi --mode rpc --approve [--session path]
```

The host understands documented envelope discriminators only. Pi owns models,
tools, packages, Agent behavior, sessions, transcript entries, compaction,
retries, and extension execution.

## Executable Resolution And Probe

Persist optional `piExecutablePath` in the surviving atomic app settings. Main
resolves candidates in order:

1. an existing executable at the explicit absolute setting;
2. current process PATH;
3. login-shell command lookup on macOS/Linux;
4. Windows command discovery.

An existing explicit executable stays authoritative through version and
capability validation. If the configured path is missing or not executable,
retain it in the status snapshot for Settings but continue automatic discovery;
version-manager multishell paths are not assumed to remain stable forever.

Resolve symlinks for display/identity without modifying the installation. Probe
`--version`, then start a short no-model RPC child and issue `get_state` and
`get_commands`. Readiness requires the exact latest version verified for the
implementation plus valid documented responses and the required command cohort.
Older releases and unverified newer releases remain unavailable until PiPilot is
updated and rechecked; there is no multi-version adapter.

General Settings reads one Main-owned executable snapshot containing configured
path, resolved canonical path, actual version, state, and bounded diagnostic. Its
file chooser, clear-to-discovery, and re-probe actions write/query that service.
Executable checks with the same configured value are single-flight. Conversation
creation and session activation await the in-progress check instead of treating
the transient `checking` state as unavailable.
About reads the real Electron app info (`app.getVersion()`, platform, arch, and
Electron version); it does not import a bundled Pi runtime constant, label Pi as
an SDK, or substitute browser-preview text when data has not loaded.

## Spawn Configuration

Spawn from Main with the resolved project or projectless cwd, inherited
environment, and no PiPilot credential/resource payload. Preserve `PI_CODING_AGENT_DIR`,
`PI_CODING_AGENT_SESSION_DIR`, provider variables, package-manager paths, and
normal host variables. Add only app-owned lifecycle metadata that cannot change
Pi behavior.

Arguments are `--mode rpc --approve` plus `--session <absolute path>` when
opening. Never add `--session-dir`; Pi's own environment/settings/default
precedence remains authoritative. Pi receives stdin/stdout pipes and a separate
stderr pipe. There is no shell interpolation and no embedded SDK fallback.

## JSONL And Correlation

Use `StringDecoder` or equivalent streaming UTF-8 decoding with a retained
buffer. Split strictly on `\n`; remove one terminal `\r`; retain the incomplete
tail. Enforce a bounded single-record size and emit a protocol diagnostic before
disconnecting on overflow or malformed JSON.

Commands are validated shared plain objects with generated UUID IDs. Writes are
serialized through one queue as `JSON.stringify(command) + "\n"`. A pending map
stores command type, generation, timer, resolve, and reject. Only a documented
`response` with matching ID and active generation settles it once.

Records without response IDs route by discriminator to Agent events, extension
UI requests, extension errors, or diagnostics. Unknown records are retained in
bounded diagnostic metadata; no inferred custom event is created.

## Lifecycle

`LocalPiRuntimeHost` owns one active generation:

1. reject new commands while replacing;
2. abort the active turn when appropriate;
3. cancel pending extension dialogs and request timers;
4. close stdin, wait briefly, then terminate only the owned child;
5. reject all pending requests for that generation;
6. spawn the replacement and complete readiness snapshot commands;
7. publish one connected generation.

Every stdout/stderr/exit callback captures its generation and child identity.
Late callbacks return before touching current state. Renderer reload reattaches
IPC subscribers to the existing owned process; it does not spawn a second one.

## Contracts And Errors

Shared schemas cover only fields in the verified latest documented contract.
Unconsumed extension payload fields remain opaque only where that current
contract explicitly permits them. Stable
host errors distinguish missing executable, failed version, incompatible RPC,
malformed output, command error, timeout, disconnected, crash, and replacement.
Raw stderr is bounded and presented as diagnostics, not parsed into policy.

## Test Fixtures

A deterministic executable fixture speaks official JSONL, can split bytes,
emit malformed/unknown records, delay responses, issue extension UI requests,
write stderr, and exit on demand. A real local smoke uses `get_state` and
`get_commands` only, so it requires no provider call.

Focused Settings tests feed real typed Main snapshots and assert loading,
missing, incompatible, ready, and retry states. Fixture values live under tests
and are never imported by production components.

Packaged verification launches with an explicit path while PATH excludes the
user's version-manager shims. The resulting process must still start and load
the selected Agent directory resources.

## Rollback

This child can land behind an internal integration seam while the legacy
renderer remains active. There is no user-visible dual-runtime toggle. Reverting
the child removes the unused host before renderer cutover.
