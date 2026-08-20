# Initialize PiPilot 0.0.1 as the First Git Release

## Goal

After the complete PiPilot `0.0.1` release tree has passed every code,
packaging, updater, UI, and native workflow gate, replace the two pre-release
commits on public `main` with one reviewed root commit and create the annotated
`v0.0.1` tag that starts the public Release workflow.

## Dependencies

- Depends on successful completion of:
  - `08-13-desktop-update-runtime`;
  - `08-13-github-actions-public-release` dry-run/native gates;
  - `08-13-update-about-ui`;
  - parent integrated quality gate.
- This child is primary-session-only. It must not be delegated to a worker or
  run concurrently with repository edits.

## Requirements

- Re-read local and remote branch/tag state immediately before every mutation.
- Audit all tracked/modified/deleted/untracked files and build one explicit
  first-release inventory. Exclude ignored artifacts, logs, test output,
  credentials, `.env` files, real user Pi/MCP/auth settings, absolute user
  paths, and machine-specific Skill symlinks/deletion noise.
- Preserve approved portable project AI collaboration files: `AGENTS.md`,
  project-owned regular `.agents/skills/trellis-*`, `pipilot-ui-style`,
  project-scoped `.claude`, `.codex`, `.pi`, non-secret `.mcp.json`, and
  `.trellis` workflow/scripts/specs/tasks/configuration.
- Exclude `.trellis/workspace/<developer>/` journals and other personal runtime
  data while retaining generic workspace documentation. Sanitize absolute user
  paths in retained historical task documents.
- Permit repository-relative platform symlinks whose targets are inside the
  committed root; reject absolute-path/machine-specific Skill symlinks.
- Create one root commit for version `0.0.1` without using destructive reset or
  checkout commands that can discard the current worktree.
- Verify the root tree, commit metadata, version, absence of parents, and local
  clean status before touching the remote.
- Present exact old/new `main` object IDs and request just-in-time confirmation.
- After confirmation, update remote `main` with `--force-with-lease` against the
  verified old remote object ID, never an unconditional force.
- Verify remote `main`, create/push annotated `v0.0.1`, and observe the public
  Release workflow authorized by the user.
- The first attempted public `v0.0.1` Release and its release-workflow run were
  explicitly deleted after native Windows blockers were reported. Keep version
  `0.0.1`, repair under child `08-14-windows-packaged-runtime-fixes`, and do not
  recreate the tag/Release until its Windows acceptance gate passes.
- After the replacement complete public Release succeeds, delete any failed
  replacement release-workflow runs and retained Actions artifacts so the
  visible release history contains only the successful `0.0.1` run. Preserve
  GitHub Issues, PRs, repository settings, and the final public Release.

## Acceptance Criteria

- [ ] The reviewed source tree is one parentless root commit with application
      version `0.0.1`.
- [ ] No ignored output, credential, host path, real user configuration, or
      machine-specific Skill link/deletion noise is committed.
- [ ] Approved portable Codex/Claude Code/Pi/Trellis project configuration is
      present, and developer-specific Trellis journals/runtime state are absent.
- [ ] Remote force update used `--force-with-lease` and matched the last verified
      `origin/main` object ID.
- [ ] Remote `main` resolves to the new root and no old release tags exist.
- [ ] Annotated `v0.0.1` points to the new root.
- [ ] The GitHub workflow creates one complete public Release only after every
      native and assembly gate passes.
- [ ] Earlier failed release-workflow runs and their retained artifacts are
      removed only after the successful public Release has been verified.
- [ ] Actual remote/workflow results are reported; no success is inferred.

## Risk Boundary

Force-updating public `main` is destructive for collaborators and existing
clones. Old Git objects may remain in prior clones, reflogs, GitHub caches, or
external archives; this operation replaces supported public history but does
not promise universal cryptographic erasure.
