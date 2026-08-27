# Design

## Architecture

### Shared contract

`src/shared/external-control.ts` owns two strict renderer-facing contracts:

- the portable server entry `{ command: 'pipilot-mcp', args: [] }`;
- a bounded launcher snapshot containing only state, restart guidance, proven
  management status, and a sanitized error. It never contains a filesystem path.

The UI wraps the server entry in the standard `mcpServers.pipilot` JSON
document for display/copy. Main remains the source of truth for whether the
launcher is usable.

### Main-owned launcher service

Add an `ExternalControlLauncherService` under `src/main/external-control/`.
It receives platform, packaged executable, descriptor path, environment,
filesystem/process adapters, and optional test seams through constructor
options. It provides side-effect-free inspection and explicit install/repair/
uninstall operations.

POSIX inspection walks PATH candidates iteratively. A target directory must be
absolute, directly stat-able without following a symlink, owned by the current
user, writable/executable, and not group/world writable. The wrapper is written
atomically with mode `0755`, contains fixed PiPilot target/descriptor arguments,
and has a PiPilot marker plus versioned receipt so unrelated files are never
overwritten. Removal revalidates the no-follow wrapper and receipt identities,
marker, fingerprint, owner, permissions, and parent directory before unlinking;
rollback uses exclusive creation so it cannot replace a concurrently recreated
target. Linux AppImage uses the stable `APPIMAGE` path rather than its temporary
mount executable.

Windows keeps the existing native Electron copy but names it
`pipilot-mcp.exe`. The install operation validates that copy, reads the current
user PATH through a bounded fixed-argument platform adapter, appends only the
application directory when absent, and reports restart guidance. Tests inject
the PATH persistence adapter; product code never invokes a shell or interpolates
user text into a command line. Its receipt proves ownership of the specific
launcher directory and records whether PiPilot created the PATH value or inserted
a separator; it does not fingerprint the entire mutable PATH. Removal deletes
exactly one normalized matching entry, preserves all remaining text and the
current registry type, verifies read-back, and rolls back PATH if receipt cleanup
fails. The packaged `pipilot-mcp.exe` is never deleted.

### Headless entry

`bootstrapMain` recognizes either the private `--pipilot-mcp-stdio` flag or the
Windows launcher basename. When the descriptor argument is omitted, Main
derives `<userData>/external-control/descriptor.json` before constructing the
repository. The stdio server still requires an absolute validated locator at
its internal boundary.

The portable client entry never sees private bootstrap flags. The POSIX
wrapper supplies them internally; Windows basename detection supplies the same
mode without a script. Existing bridge and lifecycle services remain unchanged.

### IPC and renderer

Add strict get/install/uninstall launcher IPC contracts, preload facade methods, a narrow
renderer adapter, and launcher state in `ExternalControlProvider`. IPC maps
known installer errors to bounded Main errors and never returns paths.

`ExternalControlSettings` adds one compact status/action row near the copied
configuration. Installed state uses an inline success treatment; missing/stale
state offers Install/Repair; a managed installed state offers confirmed
Uninstall; unsafe or failed state shows nearby error text.
The copy block remains available only when External Control is ready.

## Data Flow

1. Renderer loads External Control lifecycle and launcher snapshots.
2. User explicitly selects Install or Repair.
3. Main revalidates the source executable, descriptor locator, PATH target, and
   existing launcher immediately before mutation.
4. Main atomically writes/repairs its launcher or current-user PATH entry.
5. Main re-inspects and returns the authoritative bounded snapshot.
6. Renderer updates the row and tells Windows users to sign out and back in
   when PATH visibility changed.
7. A confirmed removal revalidates ownership, removes only the managed wrapper
   and receipt (POSIX) or PATH entry and receipt (Windows), then returns a
   bounded missing snapshot without changing External Control.
8. A client launches `pipilot-mcp`; the headless child reads the current
   descriptor and authenticates to the already-running local bridge.

## Failure And Recovery

- An existing unmarked `pipilot-mcp` target is a conflict and is never replaced.
- Missing executable, unsafe PATH directory, symlink target, permission error,
  PATH persistence failure, or post-write mismatch fails closed with an inline
  retryable/unsupported state.
- A moved application makes the marked wrapper stale; Repair rewrites only that
  marked wrapper.
- A missing target with a valid private receipt is cleaned idempotently. An
  invalid receipt, unreceipted target, identity race, duplicate Windows PATH
  match, or rollback/read-back mismatch fails closed without intentionally
  replacing an unrelated target.
- No failure disables or stops the existing External Control bridge.

## Compatibility

This is a direct `0.0.1` contract replacement. Old copied absolute-path client
entries are not migrated automatically because PiPilot does not own those
files. Users replace them manually with the copied JSON/server entry.

## Verification

- Unit: portable schemas, wrapper rendering/inspection/removal, unsafe target
  and uninstall race matrix, Windows PATH merge/removal/rollback, basename
  invocation, descriptor defaulting, lifecycle
  independence, and IPC error mapping.
- Electron: install/repair/uninstall states, exact copied JSON, bilingual/dark/minimum
  layout, keyboard action, and no third-party file mutations.
- Packaged: launch the installed command with empty args; verify initialize,
  six tools, local bridge client count, stdout/stderr discipline, stopped and
  disabled behavior, restart/rotation, and Windows CUI subsystem.
- Release CI remains the authority for native Windows registry/PATH behavior
  and Linux AppImage/DEB installation layouts.
