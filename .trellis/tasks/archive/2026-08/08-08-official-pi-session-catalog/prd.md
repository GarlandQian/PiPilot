# Build The Official Pi Session Catalog

## Goal

Provide bounded, read-only navigation metadata for current-format official Pi
sessions in user-selected projects and the dedicated projectless chat scope,
without introducing legacy data migration or a second session database.

## Confirmed Boundary

- A project exists only after the user explicitly selects a directory. PiPilot
  does not scan the disk, infer repositories, or treat the home directory as a
  project.
- Project Pi processes use the selected canonical directory as `cwd`.
- Projectless Pi processes use `userData/general-chat/workspace` as `cwd`.
- PiPilot never passes `--session-dir`, hard-codes `~/.pi/agent/sessions`, or
  reproduces Pi's cwd-to-directory encoding. The selected local Pi owns session
  storage and applies its normal environment, settings, and default precedence.
- After activating a scope, Main learns its actual session directory from the
  official `get_state.sessionFile` value. A learned directory is disposable
  navigation metadata, not an alternate session root or transcript database.
- Only the latest official Pi session format verified at implementation time is
  supported. There is no import, conversion, fallback path, or compatibility
  handling for previous PiPilot directories, schemas, or transcripts.
- Official Pi RPC has no complete session-list command, so a bounded read-only
  catalog is retained as desktop navigation glue. Pi remains the only writer
  and the only authority that opens a selected session.

## Requirements

### Catalog Sources And Bounds

- Resolve catalog roots only from typed conversation scopes and a Main-owned
  directory last observed from that scope's official `get_state.sessionFile`.
  The renderer never supplies a filesystem path.
- Refresh the observed directory whenever a scope is activated. Do not infer it
  from Pi implementation details or retain a PiPilot-selected session root.
- Read only direct current-format `*.jsonl` files from the learned directory for
  a requested scope. Do not recursively scan the disk or search Pi's global
  session tree.
- Bound directory entries, file size inspected for metadata, concurrent reads,
  returned rows, visible text, and diagnostics. Skip malformed/unsupported files
  without blocking valid sessions.
- Accept at most 200 direct candidates per observed directory, read at most 8 MiB
  from any accepted file and 64 MiB per refresh, use at most 8 concurrent file
  readers, and return at most 50 rows per page. Parse every accepted file through
  EOF so the latest appended `session_info` name is authoritative; do not use a
  prefix-only parser that can return a stale name.
- Require the current v3 `session` header and require its canonical `cwd` to equal
  the Main-resolved scope cwd. A shared custom Pi session directory can contain
  multiple projects, so directory containment alone is not a scope match.
- Extract only navigation metadata needed by the UI: session ID, optional name,
  first user-message preview, created/modified time, scope identity, and an
  opaque Main-owned selection token.
- Sort newest first with deterministic tie-breaking. Support a bounded first
  page plus explicit `显示更多` continuation per expanded project and a bounded
  recent projectless list.
- A never-activated scope has no learned directory. It presents an unloaded
  state until the user starts or opens that scope; PiPilot does not launch
  background Pi processes merely to decorate the sidebar.

### Selection And Runtime Handoff

- Resolve an opaque selection token back to a direct file under the catalog root
  and revalidate containment immediately before opening.
- A project task selection supplies the exact user-selected project `cwd` and
  resolved session file to the local Pi host. A projectless selection supplies
  the fixed general-chat `cwd` and resolved session file.
- The local host starts the selected latest Pi with documented
  `--mode rpc --approve --session <file>` behavior and never overrides Pi's
  session directory. Official state after startup is the authority. Catalog
  metadata never becomes a parallel transcript or runtime state machine.
- Main replaces the learned directory with `dirname(get_state.sessionFile)`
  after every successful activation. A changed Pi environment or setting is
  adopted instead of being masked by stale PiPilot configuration.
- Refresh affected catalog rows after successful official new/session-name/fork/
  clone command responses, `agent_settled`, `session_info_changed`, extension
  `entry_appended`, and controlled process replacement. Official RPC exposes no
  `session_start` event. Do not poll every project or keep inactive Pi processes
  alive.

### Write Boundary

- The catalog does not create, rewrite, copy, rename, pin, delete, repair, or
  migrate session files. New/rename/fork/clone operations go through official Pi
  RPC in the active scope.
- Do not add legacy path detection, schema upgrades, compatibility aliases, or
  startup cleanup for previous development data.

## Acceptance Criteria

- [ ] Project and projectless Pi processes receive the correct cwd and no
      `--session-dir`; Pi's own effective session location is confirmed from
      official `get_state.sessionFile`.
- [ ] An already learned inactive scope returns bounded, newest-first metadata
      without starting Pi, recursively scanning the disk, or exposing paths to
      the renderer; a never-activated scope shows an unloaded state.
- [ ] Projectless rows are cataloged separately and cannot appear as a project.
- [ ] Selecting a valid opaque row starts the latest official Pi in the correct
      scope and opens the exact session through documented CLI/RPC behavior.
- [ ] Traversal, symlink escape, stale token, unsupported format, oversized file,
      malformed header, scope/header-cwd mismatch, duplicate ID, and disappearing-file cases fail locally
      without opening a different session.
- [ ] Catalog refresh after official lifecycle/name/fork/clone events updates the
      sidebar without a second transcript store or inactive Pi process.
- [ ] Changing Pi's official session-directory configuration is adopted on the
      next scope activation without a PiPilot path migration or compatibility
      adapter.
- [ ] No product code references `agent-workspace`, `agent-sessions/default`, a
      PiPilot-owned `agent-sessions` root, a legacy session migrator,
      byte-copy/import flow, or prior PiPilot session schema.
- [ ] Focused catalog/path/IPC/runtime handoff tests, typecheck, Electron
      navigation checks, and production build pass with actual results recorded.

## Out Of Scope

- Migrating, importing, deleting, or supporting any previous PiPilot session
  directory or transcript format.
- A session database, full-text transcript search, archive UI, session pin/delete,
  or transcript mutation outside official Pi.
- Scanning arbitrary Pi session directories, inferring Pi's storage layout, or
  automatically discovering projects from session headers.
- Supporting older Pi releases or private Pi SDK/session-manager imports.

## Dependencies

- Depends on `08-08-official-pi-remote-runtime` for the latest-version local Pi
  host, owned scope startup, and generation-safe session replacement.
- Provides catalog and opaque-selection contracts consumed by
  `08-08-projectless-chats`, `08-08-sidebar-toggle-position`, the renderer
  cutover, and final verification.
