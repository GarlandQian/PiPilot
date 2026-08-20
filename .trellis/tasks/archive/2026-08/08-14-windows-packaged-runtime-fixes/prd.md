# Windows packaged runtime acceptance fixes

## Goal

Make the public Windows `0.0.1` build usable with the user's official Pi
installation: every saved project has an obvious project-owned new-session
action, selecting an existing official Pi session loads its transcript on the
first click, and an npm/fnm Windows `pi.cmd` installation exposes the existing
official Pi package-management UI.

The affected public `v0.0.1` release and prior release-workflow records were
removed before this task. The version remains `0.0.1` while these blockers are
fixed. A replacement public release is allowed only after the native Windows
acceptance gate passes; the final public branch still has one root commit and
the Actions history retains only the successful replacement release run.

## Background And Confirmed Facts

- In `src/components/layout/SessionList.tsx`, a ready project renders
  `sidebar.project.startTask` only when it has zero loaded sessions. Once a
  project has a session, the session list replaces that action. The project
  overflow menu contains only Open and Pin/Unpin, so the screenshot is correct:
  there is no stable per-project new-session entry.
- The top new-conversation control is scope-dependent and therefore cannot be
  the only way to create a session for an arbitrary saved project.
- Existing session selection already crosses catalog activation, runtime
  replacement, and renderer hydration. The official renderer contract requires
  the selected row, conversation, and inspector to remain loading until the
  exact `{ scope, generation, sessionId }` has completed `get_messages` and the
  rest of the authoritative hydration.
- `LocalPiPackageLocator` currently accepts only an executable whose real path
  is the package's declared Pi bin. A Windows npm/fnm `pi.cmd` is a generated
  command shim outside the package root, so ancestor walking necessarily
  reports package management unavailable even though normal Pi RPC works.
- npm's Windows shim has a bounded generated structure that invokes a target
  relative to `%dp0%`. Supporting that exact package-bound shim does not
  require scanning arbitrary global roots, parsing human Pi CLI output, or
  bundling another Pi SDK.
- Package version stays `0.0.1`; this task does not create `0.0.2`.

## Requirements

### R1 — Stable project-owned new-session action

- Every available saved project exposes a localized **New session** action in
  its overflow menu, whether the project is active or inactive and whether its
  catalog is empty, loading, unavailable, or already contains sessions.
- Activating the action creates a conversation in that exact project scope via
  the existing typed conversation lifecycle. It must not require first opening
  the project or relying on the currently active scope.
- Preserve the existing official lifecycle distinction: entering another scope
  may use the fresh Session created by that newly started Pi process, while an
  explicit creation inside the already active ready scope uses official
  `new_session`. Do not create a redundant second blank Session merely to make
  the new menu item work.
- The existing inline empty-project **Start task** shortcut may remain, but it
  is supplemental rather than the only project-scoped creation route.
- Reuse current PiPilot Button/DropdownMenu/Tabler icon patterns, current
  density, focus behavior, and bilingual locale catalogs. No new top-level
  navigation or visual system is introduced.

### R2 — First-click session activation and transcript hydration

- Clicking any rendered official session row always uses its opaque selection
  token and performs catalog activation; equality of project/session IDs must
  never skip the operation.
- The row, center conversation region, and session-owned inspector region stay
  in the existing centered loading state from pointer/keyboard activation until
  Main confirms the exact target and renderer hydration for the same scope,
  generation, and session ID has completed.
- The previous session's messages, model, statistics, queue, outline, files, or
  changes are never shown during activation. No intermediate empty state may
  appear before ready.
- Ready is published only after `get_state`, `get_messages`, models, commands,
  statistics, and required session projection complete for that exact target.
  The first click must show the selected session's persisted messages; a second
  click must not be required.
- Activation or hydration failure ends loading with the existing localized
  inline/error state and leaves the row retryable; it must not spin forever.

### R3 — Windows npm/fnm command-shim runtime arguments

- Treat an fnm/global npm `pi.cmd` as the same npm command-shim class as a
  `node_modules\\.bin\\pi.cmd`; do not classify npm shims solely by their path.
- Version probing, normal RPC startup, `--session <absolute-file>`, and
  `--fork <absolute-file>` must preserve the exact argv observed by the Pi CLI
  after both `cmd.exe` parsing layers.
- Paths containing spaces and Windows command metacharacters, including
  parentheses and `&`, must arrive byte-for-byte as one argument. Continue to
  use `shell: false`; do not replace the current boundary with an unbounded
  shell invocation.
- The runtime-shim classification and the package-binding resolver must share a
  bounded, explicit npm-shim proof rather than two drifting path heuristics.
- Unknown or arbitrary batch wrappers remain on the conservative generic path;
  a failure to prove safe exact argv must return a typed startup/activation
  error rather than silently opening a different Session.

### R4 — Windows npm/fnm Pi package binding

- Normal Pi RPC continues to use the exact executable discovered or configured
  by `LocalPiExecutableService`, including `.cmd`/`.bat` through the current
  Windows spawn invocation.
- For package management only, accept a Windows npm command shim when its
  bounded content and filesystem layout prove that it targets the exact
  `@earendil-works/pi-coding-agent` package belonging to that executable.
- After resolving the target, retain all existing identity checks: canonical
  regular files, exact probed Pi version, package name, declared `bin`,
  `main`/root export `./dist/index.js`, containment, and importable public
  module entry.
- Reject arbitrary batch wrappers, absolute redirects, multiple/ambiguous
  targets, oversized/non-text shims, mismatched versions, spoofed manifests,
  missing exports, and targets outside the validated package root. Do not scan
  disks or unrelated global module roots and do not parse human `pi` output.
- A valid fnm/npm layout such as
  `...\\node-versions\\<version>\\installation\\pi.cmd` with its matching
  installation package enables Packages/Resources/Models management exactly as
  the direct package-bin case does.
- A genuinely compiled or unprovable installation remains honestly
  management-unavailable while chat remains usable.

### R5 — Native Windows packaged acceptance

- Add a checked-in Windows fixture reproducing the official npm/fnm command
  shim and package topology; it must be package-bound rather than a generic
  wrapper.
- The Windows packaged smoke must exercise, in one installed/unpacked product
  flow as appropriate:
  1. discover/start Pi through the `.cmd` shim;
  2. trace exact `--session` argv through the real shim shape;
  3. show package management as available and load an official package/resource
     snapshot;
  4. add/select a project and invoke that project's explicit New session action;
  5. prove the resulting official Pi Session belongs to that project scope and
     is immediately usable;
  6. select an existing v3 Pi session and prove `get_messages` renders its
     persisted transcript on the first click with loading-to-ready and no stale
     or empty frame.
- Unit coverage owns shim acceptance/rejection and the Main conversation
  transaction. Electron coverage owns Sidebar action wiring and hydration.
  Windows packaged evidence is mandatory before republishing.

### R6 — Replacement first release

- Keep all package/application/update metadata at version `0.0.1`.
- Do not publish while any R1–R5 gate is failing.
- After the reviewed worktree and release gate pass, reconstruct the repository
  as one root commit, force-update `main` and annotated `v0.0.1` using exact
  remote leases, run the public release workflow, and verify the Release asset
  inventory.
- Remove superseded/failed workflow runs so the final visible Actions history
  retains only the successful replacement release run. Do not claim erasure
  from forks, clones, caches, or external mirrors.

## Acceptance Criteria

- [ ] A project with existing sessions still has a visible keyboard-accessible
      project overflow action that creates a new session for that project.
- [ ] An inactive project can create its own new session without an intermediate
      Open project action or dependence on the current scope.
- [ ] The creation route confirms the returned project-scoped session identity,
      updates navigation/catalog, and leaves the new chat usable without a
      redundant blank Session.
- [ ] Selecting an existing project session once transitions loading → ready,
      renders that file's persisted messages, and never shows the prior session
      or an intermediate no-session/empty view.
- [ ] Errors settle to retryable error state rather than an indefinite spinner.
- [ ] The photographed Windows fnm-style `pi.cmd` topology resolves to the exact
      Pi 0.84.1 public package and enables package management.
- [ ] The same fnm-style shim receives the exact `--session` absolute path,
      including spaces, parentheses, and `&`, and Pi confirms the selected file.
- [ ] Arbitrary or ambiguous wrappers remain rejected without affecting chat.
- [ ] Focused unit, typecheck, build, Electron, and native Windows packaged
      acceptance checks pass against the final worktree.
- [ ] The public replacement remains version `0.0.1`, `main` has one root
      commit, `v0.0.1` points to it, the Release is public and complete, and only
      the successful replacement release run remains visible in Actions.

## Out Of Scope

- Bundling Pi or adding `@earendil-works/pi-coding-agent` as a PiPilot runtime
  dependency.
- Supporting arbitrary user-authored shell/batch wrappers or broad global
  package discovery.
- Supporting incompatible Pi versions or compiled distributions that cannot
  prove an importable package identity.
- Redesigning Sidebar, Integrations, or session presentation beyond the missing
  action and truthful existing states.
- Changing update/signing policy, adding certificates, or bumping beyond
  `0.0.1`.
- Guaranteeing deletion of Git objects already copied outside the controlled
  GitHub repository surfaces.
