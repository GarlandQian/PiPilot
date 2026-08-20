# Technical Design

## Delivery Boundaries

This P0 repair has four implementation slices and one serial release operation:

1. Sidebar exposes the missing project-owned New session action by reusing the
   existing `onStartProjectTask(workspaceId)` path.
2. The existing Main conversation creation lifecycle is retained; renderer
   selection/hydration is audited independently so opening a row confirms and
   hydrates the selected Session.
3. The Windows spawn boundary recognizes a proven fnm/global npm command shim
   and preserves exact path arguments through nested `cmd.exe` parsing.
4. `LocalPiPackageLocator` reuses the same narrow Windows npm-shim proof before
   the existing package identity validator.
5. Unit/Electron/packaged fixtures reproduce the real Windows topology and
   observable flows.
6. Only the primary session performs the final one-root-commit/tag/public
   release replacement after all gates pass.

No new npm dependency or UI primitive is required.

## Sidebar Interaction

`ProjectNavigationGroup` already owns the per-project DropdownMenu and already
receives `onStartProjectTask(projectId)`. Add one localized menu item for every
available project, using the current message-plus/plus Tabler icon family and
native DropdownMenu semantics. Place it before Open project because it is the
frequent project action; retain Pin/Unpin below the existing separator rhythm.

The inline Start task child remains for a ready empty catalog. Both routes call
the same callback; no duplicate renderer state or alternate creation service is
introduced.

## Project Creation Lifecycle

The missing UI route calls the existing
`workspace.newSession({ kind: 'project', workspaceId })` path. Do not replace
the existing official lifecycle distinction:

```text
inactive/different scope
  -> start Pi in exact project cwd
  -> use the fresh Session owned by that process
  -> confirm state and publish activation

already active ready scope
  -> official new_session
  -> confirm state and publish activation
```

This task verifies that the new project-owned menu action reaches the exact
workspace ID and produces a usable project Session. It does not add an extra
`new_session` after a cross-scope start, because that would create a redundant
blank Session. This creation path remains separate from opening an existing
catalog row.

## Existing-Session Activation And Hydration

Keep Main's opaque selection-token activation and exact session-file checks.
Renderer selection retains the two-phase opening handle:

```text
row activation
  -> immediate pending UI identity
  -> Main catalog.open confirms { scope, generation, sessionId }
  -> PiRpc refresh requests authoritative session state/messages/capabilities
  -> exact hydration identity commits
  -> one loading -> ready presentation transition
```

Audit all early-return, stale-request, and cleanup paths. The selection promise
must resolve only for the matching operation. A superseding click cancels the
old waiter. A terminal runtime/hydration failure settles error. The shared
presentation gate remains the only owner of transcript and session-inspector
visibility.

## Windows Npm Command-Shim Invocation

The current launcher double-escapes command metacharacters only when the path
matches `node_modules\\.bin\\*.cmd`. A global npm install under fnm instead
places `pi.cmd` at the Node installation prefix root while retaining the same
npm `cmd-shim` nested parser and `%*` forwarding behavior.

Introduce one Main-only bounded shim classifier/resolver used by both spawning
and package location. For a proven npm-generated shim, preserve the existing
`cmd.exe /d /s /c` plus `windowsVerbatimArguments` boundary but apply the
required second escaping layer to every argument. The classifier must not rely
only on the executable pathname.

Native Windows argv tracing is authoritative: a fixture path such as
`Project (A) & Notes\\session.jsonl` must be observed by fake Pi as one exact
argument after the real batch program executes. Pure command-string assertions
are supplementary because they cannot prove the second parser's result.

## Windows Npm Command-Shim Resolution

The direct-bin path stays unchanged. On Windows only, if the selected canonical
file has `.cmd` or `.bat`, the locator reads a small bounded text record and
accepts only the npm `cmd-shim` grammar needed for a Node bin target:

- one `%dp0%`-relative target ending in the package-declared Pi bin;
- no absolute/UNC target, environment expansion other than the generated
  `%dp0%` base, command chaining, redirection, or multiple distinct targets;
- the resolved target must be a canonical regular file.

Candidate roots are derived from that exact target, not searched globally. The
existing manifest validator is extracted/reused to prove:

- package name `@earendil-works/pi-coding-agent`;
- version equals the already probed executable version;
- declared `pi` bin canonicalizes to the shim target;
- `main` and root import export equal `./dist/index.js`;
- bin and module entry remain inside the canonical package root.

The returned `executablePath` remains the configured/discovered shim so runtime
launch behavior does not change. The result additionally owns the canonical
package root/module entry used only by the isolated management helper.

Invalid/unsupported shim shapes return the existing typed management-unavailable
result; they never fall back to scanning another installation.

## Fixtures And Verification

### Pure/unit

- spawn boundary: direct executable; `.bin` npm shim; fnm/global npm shim;
  exact version/RPC/session/fork argv; metacharacter path; unknown wrapper.
- package locator: direct bin; generated fnm/npm `.cmd`; CRLF; version mismatch;
  wrong package target; arbitrary wrapper; absolute/UNC/multiple target;
  oversized/invalid text; manifest/bin/export containment.
- conversation context: retain the existing cross-scope fresh-process and
  in-place `new_session` distinction; publication follows confirmation and
  errors do not report success.
- renderer hydration: exact identity, first-click loading, superseding selection,
  error settlement, no empty/stale state.

### Electron

- project with existing rows exposes New session in its `...` menu and routes
  to that exact workspace ID;
- clicking one existing row records loading from the interaction boundary and
  renders fixture messages before ready;
- Integrations loads package/resource state through a package-bound Windows-like
  shim fixture where platform-independent seams permit.

### Native Windows packaged

The release workflow's Windows job uses a checked-in fake package matching the
official package layout and npm shim syntax. It launches the actual packaged
application, records exact argv, and proves all three user-visible blockers.
This is the release
gate; macOS simulation alone is insufficient.

## Compatibility And Rollback

- No persisted data migration.
- No renderer/shared IPC expansion is expected for the Sidebar action; reuse
  the existing callback and conversation contract.
- The locator enhancement is additive and fail-closed. Reverting it returns
  only package management to unavailable; chat remains unchanged.
- The spawn fix is fail-closed and covered by native argv evidence. Do not
  weaken escaping or enable `shell: true` as a fallback.
- Session files are never modified by the catalog except the already approved
  explicit deletion path, which this task does not change.
- The removed public Release remains absent until all checks pass. Release
  rollback before publication is simply to stop; after publication, delete the
  replacement Release/run and repair at the same `0.0.1` only under the user's
  explicit first-release policy.

## Spec Corrections After The Fix

The implementation must update executable contracts immediately after the
regressions pass:

- `backend/conversation-context.md`: retain the official cross-scope fresh
  process vs in-place `new_session` distinction while documenting the stable
  per-project UI route.
- relevant local-Pi/package-management spec: a provably package-bound official
  Windows npm command shim is importable; arbitrary wrappers remain unsupported.
- `backend/local-pi-rpc.md`: npm-shim detection is proof-based rather than
  `.bin`-path-only, and native exact-argv evidence is required for Session paths.
- `frontend/official-pi-renderer.md`/component guidance as needed: every saved
  project has a stable project-owned New session route, and first-click loading
  remains exact-identity gated.
