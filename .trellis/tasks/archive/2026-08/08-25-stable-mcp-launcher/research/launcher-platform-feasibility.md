# Research: Stable launcher platform feasibility

- Query: Determine the minimal robust current-user installation/repair design for a marked POSIX `pipilot-mcp` wrapper, Windows current-user PATH registration, and preservation of the packaged Windows CUI/fd0 MCP path.
- Scope: mixed
- Date: 2026-08-25

## Findings

### Files found

- `.trellis/tasks/08-25-stable-mcp-launcher/prd.md` - public JSON, explicit install, no-admin, no-client-mutation, and packaged smoke requirements.
- `.trellis/tasks/08-25-stable-mcp-launcher/design.md` - proposed Main-owned launcher service and POSIX/Windows split.
- `src/main/external-control/command-resolver.ts:45` - public configuration is already projected as `pipilot-mcp` with empty args, while `resolveExternalControlLauncherSource()` retains the private packaged source decision.
- `src/main/external-control/launcher-service.ts:73` - current in-progress atomic writer, wrapper renderer, PATH adapter, inspection, install, and receipt implementation.
- `src/main/bootstrap.ts:25` - headless mode is selected before importing GUI Main.
- `src/main/bootstrap.ts:36` - current Windows CUI path immediately buffers inherited fd 0 and uses a direct `createReadStream(..., { fd: 0 })` workaround.
- `src/main/external-control/mcp-stdio.ts:54` - authenticated bridge connection is completed before stdout is selected for MCP protocol output.
- `build/apply-electron-fuses.cjs:32` - the packaged Windows launcher is copied from the fused Electron executable and its PE subsystem is changed to CUI.
- `electron-builder.yml:18` - packaging uses ASAR plus an `afterPack` hook; Windows NSIS is per-user (`perMachine: false`).
- `tests/packaged/pipilot.packaged.spec.ts:968` - existing packaged test exercises the copied executable through the real private bridge.

### POSIX install and repair

The implementation should distinguish three properties instead of one generic
"safe directory" check:

1. **Resolution-safe PATH prefix**: every existing PATH directory before the
   selected launcher must not be writable by another principal. Current-user
   or root ownership is acceptable for resolution, but `mode & 0o022` must be
   zero. An empty/relative entry means the current working directory and must
   fail closed. For a missing prefix entry, inspect the nearest existing
   ancestor; accept it only when another user/group cannot create the missing
   directory. Otherwise a command placed earlier in PATH can shadow the
   installed launcher later.
2. **Installable directory**: absolute, existing, non-symlink target directory,
   owned by `process.getuid()`, `W_OK | X_OK`, and `mode & 0o022 === 0`.
   Group-writable must be rejected even when the current process belongs to the
   group; other group members can replace the command. The current worktree
   allows this case at `launcher-service.ts:445-447`.
3. **Stable location**: first reuse the receipt's still-valid PATH target, then
   prefer stable user bin roots already present in PATH (for example
   `$HOME/.local/bin` or `$HOME/bin`). Do not select transient toolchain/cache
   entries merely because they are user-owned and writable. A local inspection
   showed PATH entries such as an `fnm_multishells/.../bin`; the current
   first-safe-entry algorithm at `launcher-service.ts:351-418` could install
   there and lose the launcher when the shell state is cleaned.

For the launcher file itself:

- Inspect using `open` with `O_NOFOLLOW`, then `fstat` and read through that
  descriptor. Require a regular file, current uid, bounded size, and no
  group/world write bits. Node documents that `O_NOFOLLOW` rejects a final
  symlink.
- A marker substring alone is not proof of ownership. The current check at
  `launcher-service.ts:403` can overwrite any file containing the marker, and
  the receipt written at `launcher-service.ts:530` is not read during
  inspection. Repair should require the exact structured header plus a private
  receipt whose version, platform, canonical target and SHA-256 fingerprint
  match the currently installed bytes.
- Permit crash recovery only when the existing wrapper is byte-for-byte equal
  to the newly expected wrapper but its receipt is missing; recreate the
  receipt without rewriting the launcher. A differing stale wrapper requires
  a valid receipt before repair.
- Immediately before mutation, revalidate the directory and expected target
  identity (`dev`, `ino`, size/mtime or absence). Create a same-directory temp
  file with `O_CREAT | O_EXCL | O_NOFOLLOW`, write, `fchmod(0755)`, sync, and
  rename. Node's `rename` overwrites an existing destination, so this second
  identity check is required. A fully race-free no-clobber replace is not
  exposed portably by Node; a directory writable only by the current uid makes
  the remaining race a same-user threat.
- Do not call recursive `mkdir` for a PATH target. The directory is required to
  exist and be in PATH. A separate atomic writer may create the private receipt
  parent under `userData` after validating that parent boundary.
- Keep the no-argument guard and POSIX single-quote escaping in the wrapper.
  The wrapper may carry the private absolute executable/descriptor arguments;
  those values remain internal and do not cross Main/preload/Renderer.

There is no universal no-admin POSIX destination that also appears in every
GUI client's PATH. Finder-launched macOS apps commonly inherit only system
PATH directories. Under the task's explicit constraints (no shell-profile
edit, no `/usr/local/bin` privilege request), `unsupported` is the correct
state when no stable user-owned directory is already visible. Creating
`~/.local/bin` without also changing PATH would make the copied JSON misleading.

### Windows current-user PATH

`HKCU\Environment\Path` is the correct no-admin persistence boundary. A
process adapter must use an absolute trusted system executable and `shell:
false`; do not resolve `reg.exe` through the PATH being modified. If retaining
the current `reg.exe` approach at `launcher-service.ts:147-186`, derive and
validate `%SystemRoot%\System32\reg.exe`, use fixed argv, bound output, and
distinguish "value absent" from query/access failure.

The merge must preserve the original registry string exactly. It may split a
copy for case-insensitive/trailing-separator comparison, but on append it must
use the untouched original plus one separator. The current implementation at
`launcher-service.ts:133-145` trims entries, removes empty entries, and rebuilds
the whole value, so it does not preserve unrelated PATH content. Preserve the
existing `REG_SZ` versus `REG_EXPAND_SZ` type, reject unsupported types, enforce
the Windows environment-value size bound, read back after write, and roll back
on mismatch.

Two limitations make `reg.exe` alone less than fully robust:

- Its human-readable query output is not a stable Unicode data API; decoding
  it as UTF-8 can corrupt non-ASCII paths on some Windows code pages.
- Microsoft requires broadcasting `WM_SETTINGCHANGE` with `lParam` set to
  `Environment` after changing user/system environment variables. Registry
  persistence alone does not refresh Explorer or already-running parent
  environments, so merely restarting a client may still inherit the old PATH.

Therefore the robust Windows endpoint is a small packaged native helper (or a
native Main dependency) that calls `RegOpenKeyExW`/`RegQueryValueExW`/
`RegSetValueExW` and `SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE,
..., L"Environment", ...)`. It needs no elevation for HKCU and avoids command
parsing/encoding problems. Keep this behind the existing injected
`WindowsUserPathAdapter` so unit tests remain platform-neutral. If the task
ships `reg.exe` first, the UI and acceptance claim must say "restart the parent
launcher or sign out/in" rather than promising that a client restart alone is
enough.

Do not use `setx`: it is unnecessary shell tooling and can expand/rewrite PATH
content. Do not copy the Electron CUI executable to an arbitrary user bin;
Electron must remain beside its packaged `resources/app.asar`. Register the
packaged application directory instead.

### Preserve CUI and fd0 behavior

- Keep the Windows MCP executable as a same-directory copy of the already
  fused packaged executable. The current order in
  `build/apply-electron-fuses.cjs:53-76` is correct: flip fuses, copy, then
  change only the copy's subsystem. `afterPack` runs before signing, so a future
  signature covers the final bytes.
- Rename the copy to exact `pipilot-mcp.exe`, but retain subsystem value `3`
  (`IMAGE_SUBSYSTEM_WINDOWS_CUI`). Also validate the PE optional-header size
  and file bounds before writing the Subsystem field; Microsoft explicitly
  requires `SizeOfOptionalHeader` to bound optional-header probes.
- Select no-argument Windows headless mode from the case-insensitive basename
  of `process.execPath`, not an arbitrary argv element. Do this before the GUI
  dynamic import at `bootstrap.ts:25-28`. POSIX wrappers should continue to add
  the private flag internally.
- Do not replace or reorder the fd0 path at `bootstrap.ts:36-55`. It exists
  because Electron's Windows `process.stdin` wrapper can strand the initialize
  frame; the direct inherited descriptor is the tested behavior.
- Preserve stdout purity: `mcp-stdio.ts:70-86` catches bridge/descriptor failure,
  writes one bounded stderr line, discards input, and selects stdout only after
  successful authentication. The known Windows negative-path middle-dot is
  native CUI shutdown noise and should remain a narrowly allowlisted packaged
  test artifact, not trigger a bridge protocol rewrite.
- Packaged verification must invoke `pipilot-mcp.exe` with no public args,
  initialize MCP, list the six tools, and cover stopped/disabled cases. The PE
  inventory test should assert basename and subsystem `3`; Windows release CI
  remains authoritative for fd0 and registry behavior.

### Implemented refinement

The final implementation does not parse `reg query` stdout. It invokes the
fixed absolute system `reg.exe` with `shell: false`, exports the current-user
Environment key to a private bounded UTF-16LE `.reg` file, parses only the
structured `Path` value, and writes through a generated UTF-16LE import file.
It then exports again for exact type/value verification and rolls back on any
mismatch. This removes the code-page and leading-whitespace defects while
preserving unrelated PATH content. PiPilot still does not broadcast
`WM_SETTINGCHANGE`; the UI therefore requires sign-out/sign-in and does not
claim that restarting an individual client is sufficient.

### External references

- Node.js `path.delimiter` documents `:` on POSIX and `;` on Windows:
  <https://nodejs.org/api/path.html#pathdelimiter>.
- Node.js filesystem constants document `O_NOFOLLOW`, and `fs.rename` documents
  that an existing destination is overwritten:
  <https://nodejs.org/api/fs.html#file-open-constants> and
  <https://nodejs.org/api/fs.html#fsrenameoldpath-newpath-callback>.
- Microsoft documents `reg query` return codes and supported registry types:
  <https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/reg-query>.
- Microsoft documents `reg add` syntax:
  <https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/reg-add>.
- Microsoft requires `WM_SETTINGCHANGE`/`HWND_BROADCAST` with `Environment` for
  environment-variable changes:
  <https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-settingchange>.
- Microsoft PE format documentation defines the PE header at DOS offset `0x3c`,
  optional-header bounds, and CUI subsystem value `3`:
  <https://learn.microsoft.com/en-us/windows/win32/debug/pe-format>.
- Electron documents embedded ASAR integrity and `OnlyLoadAppFromAsar` fuses:
  <https://www.electronjs.org/docs/latest/tutorial/fuses>.
- electron-builder documents `afterPack` as the complete staged app before
  signing:
  <https://www.electron.build/docs/features/build-lifecycle/#phase-2e-post-pack-before-signing>.

### Related specs

- `.trellis/spec/backend/service-patterns.md` - Main-owned service composition,
  named errors, and repository/atomic-write patterns.
- `.trellis/spec/backend/type-and-validation-patterns.md` - strict shared
  boundary validation and secret/path containment.
- `.trellis/spec/backend/quality-guidelines.md` - packaging/native changes
  require focused unit, packaged, and platform checks.
- `.trellis/spec/guides/cross-layer-thinking-guide.md` - trace launcher state
  through Main, IPC, preload, Renderer, packaging, and tests together.
- `.trellis/spec/guides/code-reuse-thinking-guide.md` - keep one injected
  platform adapter and reuse the existing descriptor/bridge/stdout ownership.

## Caveats / Not Found

- Node/Electron exposes no built-in Windows registry plus
  `WM_SETTINGCHANGE` API. A fully Unicode-safe, immediate user-PATH update needs
  a small native boundary; `reg.exe` is an acceptable bounded fallback only
  with the weaker restart/sign-out contract described above.
- A standard POSIX user executable directory is not guaranteed to be present
  in PATH, especially for macOS applications launched by Finder. The stated
  no-admin/no-profile-edit requirements necessarily leave some installations
  unsupported.
- Native Windows PATH and fd0 behavior cannot be proven from macOS. Unit tests
  can verify adapters and bytes, but the release Windows job must exercise the
  installed package with a non-ASCII user path and the real inherited stdio
  pipe before a three-platform claim.
