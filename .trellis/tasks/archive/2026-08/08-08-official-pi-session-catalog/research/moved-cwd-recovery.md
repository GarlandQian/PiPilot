# Research: Moved-cwd Pi session recovery

- Query: How can PiPilot list and open an official Pi session whose JSONL is still in the selected project's observed session directory, but whose header `cwd` no longer exists?
- Scope: internal / installed upstream
- Date: 2026-08-09

## Findings

### Installed Pi 0.84.1 contract

The inspected executable resolves to `@earendil-works/pi-coding-agent` 0.84.1. Its default agent directory is `~/.pi/agent`, and its default session layout is:

```text
~/.pi/agent/sessions/--<resolved cwd with /, \\ and : replaced by ->--/
  <ISO timestamp with : and . replaced by ->_<session id>.jsonl
```

Evidence:

- Installed `dist/config.js:409-449` defines `getAgentDir()` and `getSessionsDir()`.
- Installed `dist/core/session-manager.js:238-253` computes the cwd-partitioned directory.
- Installed `dist/core/session-manager.js:645-669` assigns the future file path when a persisted session is created.
- Installed `docs/session-format.md:5-12` documents the same layout.

A fresh persisted process reports `get_state.sessionFile` before that file exists. The parent directory is created by the constructor, while the JSONL is first flushed only when an assistant message is appended (`dist/core/session-manager.js:596-608,645-669,724-749`). Therefore learning `dirname(get_state.sessionFile)` is sufficient after a successful activation, but not for a never-activated project or when Pi is unavailable.

### Observed moved-cwd reproduction

An observed project session may point at an older physical project directory. Its direct v3 JSONL can remain below the catalog size limit while its safe header fields show a missing historical `cwd`. No prompt or transcript content is inspected.

Current PiPilot rejects the row at `src/main/conversations/official-pi-session-catalog.ts:468-475`: failure to `realpath(header.cwd)` becomes `scopeMismatch`. The renderer then drops catalog diagnostics in `src/renderer/adapters/workspace-adapter.ts:16-19,40-71`, so this appears as an unexplained empty project list.

### Why ordinary open cannot recover it

Startup with `--session <file>` opens the source using its stored header cwd. Pi then calls `getMissingSessionCwdIssue()`. Interactive mode offers `Continue` and reopens with a runtime-only cwd override; all non-interactive modes, including RPC, print an error and exit:

- Installed `dist/core/session-cwd.js:2-35`
- Installed `dist/main.js:434-438,534-546`

The public RPC `switch_session` command does not expose `cwdOverride`; it calls `SessionManager.open(path)` and `assertSessionCwdExists()` (`dist/modes/rpc/rpc-mode.js:473-478`, `dist/core/agent-session-runtime.js:128-145`). Interactive continuation is therefore not available to PiPilot's plugin-free RPC host.

### Official recovery path

The public CLI supports `--fork <path|id>` (`docs/usage.md:195-205`). With an absolute source path, startup resolves the source before the missing-cwd check and invokes `SessionManager.forkFrom(source, process.cwd(), effectiveSessionDir)` (`dist/main.js:282-300,530-536`). `forkFrom`:

- does not require the source header cwd to exist;
- creates a new session ID and file in the current project's effective Pi session directory;
- writes a v3 header with the current cwd and `parentSession` equal to the source path;
- copies every non-header entry, preserving the full tree/history.

Evidence: installed `dist/core/session-manager.js:1234-1273`.

Thus the supported plugin-free recovery launch is:

```text
pi --mode rpc --approve --fork <absolute source JSONL>
```

It must still inherit Pi's environment and settings and must not pass `--session-dir`.

## Minimal Main-owned state machine

```text
catalog refresh
  exact existing header.cwd == project cwd -> normal opaque open token
  existing different header.cwd            -> scopeMismatch, never recover
  missing header.cwd + direct observed file -> project-only recover token

normal token
  revalidate -> host --session file -> confirm official id/file -> hydrate

recover token
  revalidate source -> serialize activation -> invalidate old token
  -> if a confirmed child already references source: host --session child
  -> otherwise host --fork source with selected project cwd
  -> confirm returned child file/id, child header cwd, and parentSession
  -> observe child directory -> refresh catalog -> hydrate through normal RPC
```

Recovery admission must require all of the following:

- scope is `project`; projectless remains exact-cwd only;
- source is a direct, regular, non-symlink v3 JSONL under the exact observed root;
- header cwd is absolute and fails specifically with `ENOENT`/`ENOTDIR`;
- an existing but different cwd remains `scopeMismatch`;
- the normal size, read-budget, changed-file, and stale-token checks still pass.

The renderer receives only the existing summary and opaque token. The token's Main cache records `open` versus `recover`; neither source nor child path crosses the catalog IPC boundary.

### Suppressing repeated forks

Use official `parentSession` as the durable relationship instead of a second transcript database. On refresh, an exact current-cwd child whose canonical `parentSession` equals the stale source is the recovered replacement. Hide the stale source once such a child exists; subsequent clicks use the child's normal `--session` token.

Also:

- keep recovery inside `OfficialPiSessionActivationService`'s serial lifecycle;
- invalidate the source cache/token before or immediately after starting recovery, so a queued double-click cannot fork twice;
- re-check for a matching child immediately before forking, covering another completed activation;
- after a successful fork, confirm the official child before normal hydration.

`forkFrom()` synchronously writes the new header and copies entries before RPC startup, so a handshake failure after startup still leaves a discoverable child. A machine crash during the synchronous copy can leave a partial child; only a child that the catalog can fully parse and Pi can successfully confirm should suppress the source.

### Custom session-directory caveat

For a custom shared session directory, physical containment alone does not identify a missing-cwd source's project. `get_state` exposes the effective file path but does not expose whether the directory is default/cwd-partitioned or shared. Under the no-layout-reimplementation/no-settings-parsing boundary, this ambiguity cannot be eliminated from one observation.

Conservative behavior:

- never recover missing-cwd rows for projectless;
- disable moved-cwd recovery when the same observed root is known for more than one scope, or when valid rows in that root prove it is shared;
- keep existing-cwd mismatches filtered in all cases;
- document that an as-yet-unobserved shared-root collision cannot be proven from official RPC 0.84.1. Fully eliminating that residual requires an explicit trusted user file-selection recovery flow or a future official API that exposes session-root provenance.

## Files found

- `src/main/conversations/official-pi-session-catalog.ts` - candidate classification, opaque tokens, stale revalidation, and recovered-child association.
- `src/main/conversations/official-pi-session-activation-service.ts` - serialized open/recover lifecycle and official confirmation.
- `src/main/local-pi/local-pi-runtime-host.ts` - add a mutually exclusive Main-only fork target that emits `--fork`, never both `--session` and `--fork`.
- `tests/fixtures/fake-pi.mjs` - currently reports a project-local fake path and hard-codes selected details instead of opening the JSONL.
- `tests/electron/pipilot.electron.spec.ts` - currently creates `<cwd>/.pi/agent/sessions/fake.jsonl`, which is not the official global layout.
- `tests/unit/official-pi-session-catalog.test.ts` - catalog/recovery classification and idempotence coverage.
- `tests/unit/local-pi-runtime-host.test.ts` - exact fork argv/cwd/environment contract.

## Test matrix

| Case | Expected result |
| --- | --- |
| v3 header cwd equals project cwd | Normal row; `--session` open |
| Header cwd exists but belongs to another project | `scopeMismatch`; no row/token |
| Header cwd is missing, file is direct in observed project root | Recover row with opaque token |
| Same missing-cwd file requested in projectless | Hidden/rejected |
| Symlink, outside path, changed source, malformed/old/oversized file | No recover token or stale rejection |
| First recover click | Exact `--mode rpc --approve --fork <source>`, selected cwd, no `--session-dir` |
| Fork confirmation | New ID/file, v3 current cwd, `parentSession=source`, complete messages/entries/tree hydration |
| Refresh after fork | Source suppressed; recovered normal row visible |
| Second click/restart | `--session <child>`; fork launch count remains one |
| Concurrent double-click | Serialized; second old token becomes stale; one fork |
| Child written but initial handshake fails | Refresh finds valid child; retry opens child rather than forking again |
| Known shared custom root | Exact cwd rows remain isolated; missing-cwd recovery disabled |
| Electron real layout | Isolated global agent root with cwd-encoded subdirectory; assert no project-local `.pi/agent/sessions` fixture and real file-derived hydration |

The fake should also return a future session file after `new_session`; its current `currentSessionFile = undefined` behavior at `tests/fixtures/fake-pi.mjs:572-580` does not model normal persisted Pi 0.84.1.

## Related specs

- `.trellis/spec/backend/official-pi-session-catalog.md`
- `.trellis/spec/backend/local-pi-rpc.md`
- `.trellis/tasks/08-08-official-pi-session-catalog/{prd,design,implement}.md`

## Caveats / Not Found

- Pi 0.84.1 has no session-list RPC and no RPC `cwdOverride` for `switch_session`.
- `--fork` is the only verified public, plugin-free subprocess startup path that recovers a missing stored cwd while keeping RPC hydration.
- The existing product design classifies all missing header cwd values as scope mismatch; supporting recovery is a deliberate contract expansion and a Pi-authored write, not a read-only open.
- The shared custom-directory ambiguity is fundamental with the currently exposed official state and must remain explicit in product behavior and tests.
